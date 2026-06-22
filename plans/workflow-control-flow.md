# Workflow Control Flow — Implementation Plan

## What we're adding

Four new step types: `parallel`, `conditional`, `retry`, `loop`.

All four are implemented as **composite steps** in `apps/api/src/index.ts`. They wrap child `StepDef`s and return a `WorkflowStep` whose `run()` handles the control flow internally. The core `Workflow` class in `packages/core` stays unchanged — it still executes its step list sequentially; the composition happens inside individual step implementations.

---

## 1. `retry`

Simplest to add. Wraps a single child step and retries it on failure.

```ts
type RetryStepDef = {
  type: "retry";
  step: StepDef;
  maxAttempts: number;          // total attempts (not retries)
  delayMs?: number;             // base delay between attempts (default 500)
  backoff?: "fixed" | "exponential";  // default "fixed"
}
```

**Behaviour:**
- Calls `childStep.run(input, ctx)` up to `maxAttempts` times.
- On failure, sleeps `delayMs * (exponential ? 2^attempt : 1)`, then retries.
- After all attempts exhausted, rethrows the last error (triggers saga rollback upstream).
- Emits a `retry_attempt` exec_event into the ledger on each retry so progress is visible.

**Changes:**
- `apps/api/src/index.ts` — add `retry` to `StepDef` union; `buildStep` calls `buildRetryStep(def)`.
- `packages/sdks/typescript/src/client.ts` — add `RetryStepDef` to the exported `StepDef` union.

---

## 2. `conditional`

Evaluates a structured predicate against the current `WorkflowState` and runs one of two branch sequences.

```ts
type ConditionalStepDef = {
  type: "conditional";
  condition: Predicate;
  then: StepDef[];
  else?: StepDef[];
}

type Predicate =
  | { op: "eq" | "neq"; field: string; value: unknown }
  | { op: "gt" | "lt" | "gte" | "lte"; field: string; value: number }
  | { op: "exists" | "not_exists"; field: string }
  | { op: "and" | "or"; predicates: Predicate[] }
```

`field` is a dot-path into `WorkflowState` — e.g. `"exitCode"` or `"commandEvents.0.type"`.

**Behaviour:**
- Resolves `field` from state using a `getPath(state, dotPath)` helper.
- Evaluates the predicate (no `eval` — pure structural matching).
- If truthy: runs `then` steps sequentially using the same `ctx`.
- If falsy and `else` is set: runs `else` steps.
- If falsy and no `else`: passes input through unchanged.
- Output is the last step's output from whichever branch was taken, or the original input if no branch ran.

**Changes:**
- `apps/api/src/index.ts` — add `conditional` + `Predicate` types; `getPath()` utility; `evaluate(predicate, state)` helper; `buildConditionalStep()`.
- `packages/sdks/typescript/src/client.ts` — export `ConditionalStepDef` and `Predicate`.

---

## 3. `loop`

Iterates over an array in `WorkflowState` and runs a sequence of child steps for each item.

```ts
type LoopStepDef = {
  type: "loop";
  over: string;       // dot-path into WorkflowState pointing to an array
  as: string;         // key injected into state for each iteration, e.g. "item"
  steps: StepDef[];   // run for each item
  parallel?: boolean; // run all iterations concurrently (default false)
}
```

**Behaviour:**
- Resolves `over` from state — must be an array, throws if not.
- **Sequential** (`parallel: false`): for each item, injects `{ [as]: item, loopIndex: i }` into state, runs `steps` in order, feeds output into next iteration.
- **Parallel** (`parallel: true`): fans out all iterations with `Promise.all`, injects item into each branch's initial state independently.
- Collects all iteration outputs into `loopResults: unknown[]` on the final state.
- Uses the same `getPath` utility introduced by `conditional`.

**OpenSandbox note:** When looping over `exec_command` steps in the **same** sandbox with `parallel: true`, use `background: true` on the underlying command execution to avoid blocking a single connection. `ExecClient.executeCommand()` already supports this via `background: true` in `ExecuteCommandOptions` — the execd daemon assigns a session ID and returns immediately. Poll `getCommandStatus(sessionId)` until done, then `getCommandOutput(sessionId)` for stdout/stderr.

**Changes:**
- `apps/api/src/index.ts` — add `loop` to `StepDef` union; `buildLoopStep()`.
- `packages/sdks/typescript/src/client.ts` — add `LoopStepDef`.

---

## 4. `parallel`

Runs multiple child steps concurrently, merging their outputs.

```ts
type ParallelStepDef = {
  type: "parallel";
  steps: StepDef[];   // run all of these at the same time
}
```

**Behaviour:**
- All branches receive the same `input` state.
- Each branch gets a child context with `stepIndex = parentIndex * 1000 + branchIndex` to keep ledger entries distinct.
- Runs with `Promise.all(branches.map(s => s.run(input, childCtx)))`.
- Outputs are merged shallowly in branch order (later branches overwrite earlier on key conflicts).
- `parallelResults: unknown[]` is also written to state with each branch's raw output.
- If any branch fails: wait for all others to settle, then rethrow — the outer saga rollback handles cleanup.
- SSE stream will show interleaved events from all branches; `stepIndex` in each entry identifies the branch.

**Ledger change:** Add `branch?: number` to `LedgerEntry` in `packages/core/src/ledger.ts`. The parallel step sets this to the branch index when emitting events so consumers can demux branches.

**OpenSandbox note:** Running parallel `exec_command` steps against the **same** sandbox opens multiple concurrent SSE streams to execd. The execd daemon handles multiple concurrent connections (each gets its own session). No special handling needed — `Promise.all` over `executeCommand()` calls works as-is.

**Changes:**
- `packages/core/src/ledger.ts` — add `branch?: number` to `LedgerEntry`.
- `apps/api/src/index.ts` — add `parallel` to `StepDef`; `buildParallelStep()`; child context factory that threads the branch index through `emit`.
- `packages/sdks/typescript/src/client.ts` — add `ParallelStepDef`; add `branch?: number` to `WorkflowEvent`.

---

## Recursive schema problem

`parallel`, `retry`, `loop`, and `conditional` all contain child `StepDef`s, making the schema self-referential. Elysia's `t.Recursive()` handles this:

```ts
import { t, type TSchema } from "elysia";

const StepSchema: TSchema = t.Recursive((Self) =>
  t.Union([
    // existing leaf steps ...
    t.Object({ type: t.Literal("parallel"), steps: t.Array(Self) }),
    t.Object({ type: t.Literal("retry"), step: Self, maxAttempts: t.Number(), ... }),
    t.Object({ type: t.Literal("loop"), over: t.String(), as: t.String(), steps: t.Array(Self), parallel: t.Optional(t.Boolean()) }),
    t.Object({ type: t.Literal("conditional"), condition: PredicateSchema, then: t.Array(Self), else: t.Optional(t.Array(Self)) }),
  ])
);
```

`PredicateSchema` is also recursive (for `and`/`or` nesting) and needs the same treatment.

---

## Implementation order

1. **`retry`** — no schema recursion needed, leaf step, isolated change.
2. **`conditional`** — introduces `getPath` utility and `Predicate` type.
3. **`loop`** — reuses `getPath`; adds `parallel` flag with background-exec pattern.
4. **`parallel`** — most structural: ledger change, sub-context indexing, recursive schema.

Do the recursive `StepSchema` refactor as part of step 4 (or before it as its own commit) since steps 1–3 only add new leaf types that don't need recursion yet.

---

## Files touched

| File | Change |
|---|---|
| `packages/core/src/ledger.ts` | Add `branch?: number` to `LedgerEntry` |
| `apps/api/src/index.ts` | New `StepDef` variants, `buildStep` cases, helper utilities, recursive schema |
| `packages/sdks/typescript/src/client.ts` | New `StepDef` variants exported, `branch?` on `WorkflowEvent` |
