# Modularity Refactor

No public APIs change. `packages/core/src/index.ts` and `packages/sdks/typescript/src/index.ts` keep
exactly the same exports. Only internal file layout changes.

Three phases, each independently shippable.

---

## Current pain points

| File | Lines | Problem |
|---|---|---|
| `packages/core/src/steps.ts` | 428 | One giant switch handles all 13 step types + helpers |
| `packages/sdks/typescript/src/client.ts` | 539 | Sandbox mgmt, snapshots, diagnostics, run management, workflow execution, semaphore all in one class |
| `packages/sdks/typescript/src/workflow.ts` | 423 | Four builder classes + LoopVar + helper types in one file |

---

## Phase 1 — `@drej/core`: split `steps.ts` into a `steps/` directory

### New layout

```
packages/core/src/
  steps/
    types.ts          — StepDef union, Predicate, WorkflowState, SnapshotConfig
    utils.ts          — getPath(), interpolate(), evaluate(), runWithConcurrency()  [all private/internal]
    sandbox.ts        — create_sandbox + delete_sandbox builders; resolveExecClient()
    exec.ts           — exec_command + exec_code builders
    file.ts           — write_file + read_file builders
    snapshot.ts       — snapshot builder; shouldSnapshot(), waitForSnapshot()
    control-flow.ts   — retry, conditional, loop, parallel, sequence builders
    index.ts          — buildStep() factory + barrel re-exports
```

### How `buildStep` changes

Currently `buildStep` is a 300-line switch that contains the full implementation of every step type.
After the split, each module exports a focused `build*` function and `buildStep` becomes a thin router:

```ts
// steps/sandbox.ts
export function buildCreateSandboxStep(def: Extract<StepDef, { type: "create_sandbox" }>): WorkflowStep { ... }
export function buildDeleteSandboxStep(): WorkflowStep { ... }

// steps/index.ts
export function buildStep(def: StepDef): WorkflowStep {
  switch (def.type) {
    case "create_sandbox":  return buildCreateSandboxStep(def);
    case "delete_sandbox":  return buildDeleteSandboxStep();
    case "exec_command":    return buildExecCommandStep(def);
    case "exec_code":       return buildExecCodeStep(def);
    case "write_file":      return buildWriteFileStep(def);
    case "read_file":       return buildReadFileStep(def);
    case "snapshot":        return buildSnapshotStep();
    case "retry":           return buildRetryStep(def);
    case "conditional":     return buildConditionalStep(def);
    case "loop":            return buildLoopStep(def);
    case "parallel":        return buildParallelStep(def);
    case "sequence":        return buildSequenceStep(def);
  }
}
```

### What each module owns

**`steps/types.ts`** — pure types, no runtime code
```ts
export type { StepDef, Predicate, WorkflowState, SnapshotConfig }
```

**`steps/utils.ts`** — internal helpers, not re-exported from the barrel
```ts
getPath(obj, path)         // dot-path traversal on workflow state
interpolate(template, state) // {{var}} substitution
evaluate(predicate, state)  // predicate tree evaluation
runWithConcurrency(tasks, max) // worker-pool concurrency primitive
```

**`steps/sandbox.ts`**
```ts
export { buildCreateSandboxStep, buildDeleteSandboxStep, resolveExecClient }
```
Imports: `utils.ts` (nothing), `@drej/opensandbox`

**`steps/exec.ts`**
```ts
export { buildExecCommandStep, buildExecCodeStep }
```
Imports: `utils.ts` (getPath, interpolate), `@drej/opensandbox`

**`steps/file.ts`**
```ts
export { buildWriteFileStep, buildReadFileStep }
```

**`steps/snapshot.ts`**
```ts
export { buildSnapshotStep, shouldSnapshot, waitForSnapshot }
```

**`steps/control-flow.ts`**
```ts
export { buildRetryStep, buildConditionalStep, buildLoopStep, buildParallelStep, buildSequenceStep }
```
Imports: `utils.ts` (evaluate, runWithConcurrency), calls `buildStep` from `index.ts`
(small circular reference: control-flow steps call buildStep to build their children — resolved by
importing `buildStep` from the barrel, which is fine as long as Node/Bun resolves the module graph
before first call, which it does)

**`steps/index.ts`** — barrel + factory
```ts
export { buildStep }
export type { StepDef, Predicate, WorkflowState, SnapshotConfig } from "./types"
export { resolveExecClient, shouldSnapshot, waitForSnapshot } from "./sandbox"  // keep public
// internal builders NOT re-exported
```

**`packages/core/src/index.ts`** — one import path changes, exports unchanged:
```ts
// before
export { buildStep, resolveExecClient, shouldSnapshot, waitForSnapshot } from "./steps";
export type { StepDef, Predicate, WorkflowState, SnapshotConfig } from "./steps";

// after
export { buildStep, resolveExecClient, shouldSnapshot, waitForSnapshot } from "./steps/index";
export type { StepDef, Predicate, WorkflowState, SnapshotConfig } from "./steps/index";
```

---

## Phase 2 — `drej` SDK: split `client.ts`

`client.ts` has three logically distinct concerns:

1. **Public-facing types** — `DrejError`, `WorkflowRun`, `DrejClientOptions`, `RunOptions`, `WorkflowEvent`
2. **Streaming engine** — `_makeStream()`, `_execute()` (the async generator pipeline)
3. **`DrejClient` class** — public method surface that composes everything

### New layout

```
packages/sdks/typescript/src/
  types.ts      — DrejError, DrejClientOptions, RunOptions, WorkflowEvent, WorkflowRun
  stream.ts     — makeStream() function (extracted from _makeStream)
  client.ts     — DrejClient class (imports from types.ts, stream.ts)
  index.ts      — unchanged
```

### `types.ts`

Move out of `client.ts`:
- `DrejError`
- `DrejClientOptions`
- `RunOptions`  
- `WorkflowEvent` (type alias)
- `WorkflowRun` class

`WorkflowRun` uses `RunStatus` (from `@drej/core`) and `WorkflowEvent` — both available in this file.

### `stream.ts`

Extract the streaming engine as a standalone function:

```ts
// stream.ts
export function makeStream(
  name: string,
  runId: string,
  adapter: IStorageAdapter,
  control: ControlClient,
  execute: (deps: WorkflowDeps) => Promise<void>,
): AsyncGenerator<WorkflowEvent> { ... }
```

`_makeStream` currently closes over `this.control` and `this.adapter` — passing them as parameters
removes the dependency on the class instance, making `makeStream` a pure function that's easy to test
and reason about in isolation.

### `client.ts` after

Shrinks to ~250 lines: constructor, semaphore helpers, and public method delegations.
All private implementation detail lives in `stream.ts`; all types live in `types.ts`.

```ts
// client.ts
import type { DrejClientOptions, RunOptions, WorkflowEvent } from "./types";
import { DrejError, WorkflowRun } from "./types";
import { makeStream } from "./stream";

export class DrejClient {
  // ... constructor, semaphore, public methods
}
```

---

## Phase 3 — `drej` SDK: split `workflow.ts` into `builder/`

### New layout

```
packages/sdks/typescript/src/
  builder/
    types.ts        — SandboxOpts, LoopItem, LoopVar (private), ForEachOpts, ForEachSource,
                      ForEachCallback, wrapSteps()
    sandbox-step.ts — SandboxStepBuilder, SandboxParallelBuilder
    workflow.ts     — WorkflowBuilder, WorkflowParallelBuilder, workflow()
    index.ts        — re-exports: workflow, WorkflowBuilder, SandboxStepBuilder, SandboxOpts, LoopItem
```

### Dependency graph within `builder/`

```
types.ts  ←  sandbox-step.ts  ←  workflow.ts  ←  index.ts
```

No cycles. `sandbox-step.ts` imports `types.ts` for shared types; `workflow.ts` imports both
`types.ts` and `sandbox-step.ts` since `WorkflowBuilder.sandbox()` accepts a `SandboxStepBuilder`
callback.

### `packages/sdks/typescript/src/index.ts` — one import path changes

```ts
// before
export { workflow, WorkflowBuilder, SandboxStepBuilder, CodeLanguage } from "./workflow";
export type { SandboxOpts, LoopItem } from "./workflow";

// after
export { workflow, WorkflowBuilder, SandboxStepBuilder, CodeLanguage } from "./builder/index";
export type { SandboxOpts, LoopItem } from "./builder/index";
```

---

## What does NOT change

- All public exports from `drej` and `@drej/core` — zero breaking changes
- `packages/adapters/postgres/` — already well scoped, no split needed
- `packages/adapters/sqlite/` — same
- `packages/adapters/otel/` — single file, already focused
- `packages/opensandbox/` — already split correctly (control.ts, exec.ts, types.ts)
- `packages/core/src/workflow.ts` — 291 lines, focused, no split needed
- `packages/core/src/ledger.ts` — 107 lines, already minimal

---

## Changeset

Minor bump on `@drej/core` and `drej` (internal restructure, technically a non-breaking refactor
but bumping minor to signal intentional change and keep changeset CI happy).
