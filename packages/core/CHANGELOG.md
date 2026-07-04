# @drej/core

## 0.5.3

### Patch Changes

- a4856f1: Fix every published package that depends on a sibling workspace package shipping a literal `"workspace:*"` version string instead of a real semver range.

  `changeset publish` always shells out to plain `npm publish`, which has no concept of the `workspace:` protocol — unlike `bun publish`/`pnpm publish`, which resolve it automatically. Every currently published version of `drej`, `@drej/agent`, `@drej/workflow`, and `drejx` has `"workspace:*"` in its `dependencies`, which `npm install` cannot resolve at all (`EUNSUPPORTEDPROTOCOL`). Installing any of these packages from npm fails outright.

  Added `scripts/resolve-workspace-protocol.ts`, run in CI immediately before `npm publish`, which rewrites every `workspace:*`/`workspace:^`/`workspace:~` dependency range to the corresponding package's already-resolved version before the tarball is packed.

- Updated dependencies [a4856f1]
  - @drej/opensandbox@0.2.3

## 0.5.2

### Patch Changes

- a91651c: Fix npm publish failures and a broken `drejx` CLI build:

  - Add the missing `repository` field to every published package's `package.json`. Without it, npm rejects publishes with `provenance: true` enabled (added previously) — every package failed to publish with a 422 "Error verifying sigstore provenance bundle" (see the last "Version Packages" release run).
  - Add `packages/cli` to the root `build` script. It was never built by CI before publish, so every previously-published `drejx` version (up to and including 0.2.1 on npm) shipped with no `dist/` folder at all — the CLI has never actually worked when installed from npm.
  - Remove a duplicate shebang in `packages/cli/tsdown.config.ts`'s `banner` config (the source file already has its own `#!/usr/bin/env bun`), which produced a syntactically broken `dist/index.mjs` whenever the package _was_ built manually.
  - Add `packages/agent` and `packages/cli` to the root `typecheck` script — both were previously only checked ad hoc.

- Updated dependencies [a91651c]
  - @drej/opensandbox@0.2.2

## 0.5.1

### Patch Changes

- 34cfa8b: Add the missing `license` field (Apache-2.0) to every published package's `package.json`, matching the repo's root `LICENSE` file.
- bca2a6b: Fix JSDoc comments that no longer matched the code they document (stale `DrejClient` references, incorrect claims about `DrejError`, `watchMetrics()`, `resume()`, `exec()` ledger logging, `CommandError`, `computeSetupHash`, `bash()` streaming, and the `when()` predicate context), and flag two fields (`AgentSpec.cliVersion`, `.metadata`, `.registryDependencies`) and one known concurrency limitation (`FlushContext` under `forEach({ concurrency > 1 })`) that are currently no-ops/buggy rather than doing what they were documented to do. No behavior changes — doc-only.
- 3f362d1: Enable npm provenance for published packages.
- Updated dependencies [34cfa8b]
- Updated dependencies [3f362d1]
  - @drej/opensandbox@0.2.1

## 0.5.0

### Minor Changes

- f803858: Agent snapshotting: `Agent.load()` checkpoints the sandbox after Pi install and restores from the snapshot on subsequent loads, reducing startup from ~90s to ~8s. `checkpoint()` now returns the snapshot ID. New `Drej.restoreSnapshot(snapshotId, name, resources)` creates a sandbox from a snapshot without exec replay. `Agent.load()` accepts `{ rebuild: true }` to force reinstall.
- c81c77d: Sandbox API extensions: `pause()` / `resume()`, `createSession()` / `BashSession` persistent shell sessions, `diagnosticLogs()` / `diagnosticEvents()`, `watchMetrics()` streaming, and `Drej.connect()` for attaching to an already-running container. Agent: `Agent.resume(sandboxId)` to reconnect a new host process to a live agent sandbox (restarts the bridge with `--continue`).

### Patch Changes

- Updated dependencies [c81c77d]
  - @drej/opensandbox@0.2.0

## 0.4.0

### Minor Changes

- 2bbd8dc: refactor: pivot drej to sandbox execution substrate

  **`drej`**

  - Remove `client.run()`, `WorkflowRun`, builder API
  - Add `client.sandbox()` returning a live `Sandbox` object; `sandboxId` is the OpenSandbox container ID and ledger key
  - Add `client.resume(sandboxId)` for checkpoint-based replay
  - Add `client.sandboxes.*` for listing and managing sandbox history

  **`@drej/core`**

  - Remove `steps/`, `workflow.ts`, `validate.ts`
  - Add `Sandbox` class with `exec()`, `execCode()`, `writeFile()`, `readFile()`, `checkpoint()`, `close()`, and more
  - Add `ExecHandle` — `PromiseLike<ExecResult>` with `pipe()`, `stdout()`, `result()`; supports streaming and ledger-replay modes
  - Add `SandboxHooks` for observability (`onSandboxCreated`, `onExecStart`, `onExecComplete`, `onCheckpoint`, `onSandboxClosed`, `onSandboxFailed`)
  - New `LedgerEvent` variants: `sandbox_created`, `exec_start`, `exec_event`, `exec_complete`, `checkpoint_created`, `sandbox_closed`
  - Rename `RunStatus` → `SandboxStatus`, `RunDetails` → `SandboxDetails`, `ListRunsOptions` → `ListSandboxOptions`
  - `LedgerEntry` fields: `workflowName` → `name`, `runId` → `sandboxId`

  **`@drej/sqlite` / `@drej/postgres`**

  - Schema: columns `run_id` → `sandbox_id`, `wf_name` → `name`
  - AGG query now derives status from `sandbox_created` / `sandbox_closed` events and counts `exec_complete` for `execCount`
  - `lastCheckpoint()` now queries `checkpoint_created` (was querying the old `checkpoint` event)
  - Adapter methods renamed: `listRunDetails` → `listSandboxDetails`, `listAllRunDetails` → `listAllSandboxDetails`, `getRunDetails` → `getSandboxDetails`, `deleteRun` → `deleteSandbox`

  **`@drej/workflow`**

  - New package: lazy `WorkflowBuilder` with `sandbox()`, `parallel()`, `sequence()`
  - Synchronous `SandboxBuilder` queues `exec`, `checkpoint`, `retry`, `when`, `forEach` ops; flushed at `.pipe()` time

  **`@drej/otel`**

  - Rewrite hooks from workflow-step model to sandbox/exec model (`SandboxHooks`)
  - OTel span attribute `drej.run.id` → `drej.sandbox.id`

### Patch Changes

- 10417e3: feat: add drejx CLI with Docker-based OpenSandbox init and registry support; add useServerProxy option to Drej client
- 416bc72: Remove `SandboxStatus.Failed` and `SandboxStatus.Cancelled` enum values and `SandboxDetails.error` field — these were never derivable from ledger events and could not be produced by any code path.
- Updated dependencies [10417e3]
  - @drej/opensandbox@0.1.4

## 0.3.0

### Minor Changes

- 22b8a32: feat: concurrency limits

  Add `maxConcurrency` to `DrejClientOptions` to cap simultaneous workflow runs — `run()` awaits a slot before starting when at capacity. Add `maxConcurrency` to `parallel` and `loop` StepDefs so branches and loop iterations are throttled via a worker-pool; the `parallel()` and `forEach()` builders expose this as an `opts.concurrency` argument.

- 799b6dd: Add file ops steps and `ref()` builder API

  New step types: `deleteFile`, `moveFile`, `listDirectory`, `searchFiles`.

  `listDirectory` stores `DirectoryEntry[]` in state under the given key; `searchFiles` stores `string[]` which can be passed directly to `forEach`.

  New `ref<T>(name)` function creates a typed state reference. Use it instead of raw `"{{name}}"` strings anywhere the builder accepts a captured value:

  ```ts
  const sha = ref<string>("sha");
  const tsFiles = ref<string[]>("tsFiles");

  workflow("build").sandbox({ image: { uri: "node:20" } }, (s) =>
    s
      .exec("git rev-parse HEAD", { capture: sha })
      .searchFiles("**/*.ts", { as: tsFiles })
      .forEach(tsFiles, (s, file) => s.exec(`tsc ${file}`))
      .exec("deploy.sh", { envs: { GIT_SHA: sha } })
  );
  ```

  `Ref<T>` objects also work naturally in template literals: `` `echo ${sha}` `` expands to `"echo {{sha}}"` at build time.

  Also fixes: `cwd` and `envs` values in `exec()` are now interpolated against workflow state at runtime (previously passed verbatim).

- 8d9d8bb: refactor: split large source files into focused modules

  `@drej/core`: `steps.ts` (428 lines) split into `steps/` directory — `types.ts`, `utils.ts`, `sandbox.ts`, `exec.ts`, `file.ts`, `snapshot.ts`, `control-flow.ts`, `index.ts`. `buildStep` becomes a thin router that delegates to per-step-type builders; no circular dependencies.

  `drej` SDK: `client.ts` split into `types.ts` (DrejError, WorkflowRun, option interfaces) and `stream.ts` (makeStream standalone function). `workflow.ts` split into `builder/` directory — `types.ts`, `sandbox-step.ts`, `workflow.ts`, `index.ts`. No public API changes.

- 2fd33e0: feat: run management API

  Add `RunStatus` enum, `RunDetails` type, and `ListRunsOptions` for filtering. Replace `listRuns()` with `listRunDetails()`, `listAllRunDetails()`, `getRunDetails()`, and `deleteRun()` on both `IStorageAdapter` and `DrejClient`. Add `WorkflowRun.status` property that tracks execution state as events are consumed.

- 0d94c2a: Add per-step timeout and AbortSignal cancellation

  **Per-step timeouts**: steps now accept `timeoutMs` to cap execution time. A
  global fallback can be set via `RunOptions.stepTimeoutMs`. When exceeded, the
  step fails with `StepTimeoutError` and rollback runs automatically.

  **Cancellation**: `WorkflowRun.cancel()` aborts the run immediately. Breaking
  out of the `for await` loop does the same. Pass `RunOptions.signal` to wire in
  an external `AbortController` or `AbortSignal.timeout()`.

  Both features share the same internal mechanism: a per-step `AbortController`
  scoped to both `ControlClient` and `ExecClient` via `withSignal()`, so
  in-flight HTTP calls and SSE exec streams are cancelled cleanly at the fetch
  level. Rollback still runs with unscoped clients to ensure cleanup always
  completes.

### Patch Changes

- Updated dependencies [0d94c2a]
  - @drej/opensandbox@0.1.3

## 0.2.0

### Minor Changes

- 4c0ad93: Add `capture` option to `exec()` for storing stdout in workflow state

  Pass `{ capture: "key" }` to store a command's stdout under that key in
  workflow state. The value is immediately available for interpolation in
  subsequent steps via `{{key}}`, or accessible on `WorkflowState` after
  the run. Trailing newlines are trimmed.

  ```ts
  workflow("deploy").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
    s
      .exec("git rev-parse HEAD", { capture: "sha" })
      .exec("echo deploying commit {{sha}}")
  );
  ```

- a971b7b: Add `s.readFile(path, { as })` step to read sandbox files into workflow state

  File contents are stored under the given key and immediately available for
  interpolation in subsequent steps via `{{key}}`, or accessible on the final
  workflow state after the run. Supports `utf8` (default) and `base64` encoding.

  ```ts
  workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
    s
      .exec('node -e "process.version" > /tmp/version.txt')
      .readFile("/tmp/version.txt", { as: "version" })
      .exec("echo Node version: {{version}}")
  );
  ```

- ce173be: Make sandbox lifecycle explicit — no more implicit deletion

  Previously `workflow().sandbox(opts, fn)` automatically deleted the sandbox
  at the end of the workflow and on rollback. Sandbox lifecycle is now the
  caller's responsibility.

  **What changed:**

  - `sandbox()` no longer appends a `delete_sandbox` step or rolls back on failure
  - `sandbox()` now accepts an existing `Sandbox` object in place of `SandboxOpts`,
    letting you pass a sandbox you created and manage yourself
  - Call `client.deleteSandbox(id)` explicitly when you are done with a sandbox

  ```ts
  // Create a fresh sandbox — stays alive after the workflow
  const run = await client.run(
    workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
      s.exec("npm ci").exec("npm test"),
    ),
  );
  for await (const ev of run) { ... }
  await client.deleteSandbox(run.sandboxId); // explicit cleanup

  // Or manage the sandbox yourself
  const sb = await client.createSandbox({ image: { uri: "node:20-slim" } });
  await client.run(workflow("build").sandbox(sb, (s) => s.exec("npm test")));
  await client.run(workflow("lint").sandbox(sb, (s) => s.exec("npm run lint")));
  await client.deleteSandbox(sb.id);
  ```

- 86c2dde: Add `s.snapshot()` as a first-class workflow step

  Previously, capturing a sandbox snapshot required passing `snapshotConfig: { afterSteps: [N] }` to `client.run()` — which meant counting step indices upfront and re-counting whenever steps were reordered.

  `s.snapshot()` declares the checkpoint inline, where it belongs:

  ```ts
  workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
    s
      .exec("npm ci")
      .snapshot() // checkpoint: deps installed
      .exec("npm test")
  );
  ```

  The snapshot ID is persisted to the ledger and stored in workflow state as `snapshotId`. `client.replayFromSnapshot()` works the same way regardless of which method was used to take the snapshot.

  `snapshotConfig` on `client.run()` remains supported — it is useful when you need to snapshot a workflow you didn't write, or snapshot on a cadence (`everyNSteps`) rather than at a fixed point.

- 82094ae: Add typed workflow errors: `SandboxError`, `ExecConnectionError`, `CommandError`.

  Infra failures (sandbox boot failure, execd connection timeout) now throw typed errors instead of generic `Error`. Add `strict` option to `exec()` — when enabled, a non-zero exit code throws `CommandError` with the exit code attached. Errors propagate through the `WorkflowRun` async iterator so callers can catch them with a standard `try/catch` around the `for await` loop. All failures continue to be recorded in the ledger via `LedgerEvent.StepFailed`.

### Patch Changes

- b04f8eb: Add `execCode()` to the workflow builder and expose exit code in workflow state.

  `SandboxStepBuilder.execCode()` lets you run code directly (Python, Node.js, etc.)
  via execd's code interpreter — with optional stateful context to share variables
  across calls. Previously only shell commands (`exec()`) were available in the builder.

  `exec()` now captures the command exit code from the SSE stream and sets
  `exitCode` on workflow state after each step. This makes `when({ field: "exitCode" })`
  predicates actually useful for branching on command success or failure.

  `CodeContext` is now exported from the `drej` package for consumers who want to
  type context options explicitly.

- Updated dependencies [b04f8eb]
  - @drej/opensandbox@0.1.2

## 0.1.1

### Patch Changes

- 0ea4c33: Rename npm scope from `@drej/*` to `@drej/*` and add TSDoc to all public API surfaces.

  - All workspace packages now published under `@drej/*` (e.g. `@drej/sqlite`, `@drej/postgres`)
  - `DrejClient`, `WorkflowBuilder`, `SandboxStepBuilder`, `IStorageAdapter`, `LedgerEvent`, `SandboxOpts` and all their members now have hover documentation visible in VS Code

- Updated dependencies [0ea4c33]
  - @drej/opensandbox@0.1.1

## 0.1.0

### Minor Changes

- 82e77fd: Introduce pluggable storage adapter system.

  - `ILedger` renamed to `IStorageAdapter` with optional `connect()` and `close()` lifecycle methods
  - `DrejClientOptions.adapter` accepts any `IStorageAdapter` implementation; `DrejClient` exposes matching `connect()` and `close()` methods
  - New `@drej/postgres` package: `PostgresAdapter` backed by a user-supplied Postgres connection string; owns its schema and runs migrations on `connect()`

- 5d77498: Bundle SDK, publish workspace packages publicly, and make adapter required.

  - `@drej/core` and `@drej/opensandbox` are now published public packages (previously private workspace-only)
  - `drej` SDK ships a pre-built `dist/` with a bundled ESM JS file and TypeScript declarations; `"main"` now points to `./dist/index.js`
  - `WorkflowDeps.ledger` field renamed to `WorkflowDeps.adapter`
  - `DrejClientOptions.adapter` is now **required** — callers must supply a storage adapter (`@drej/sqlite`, `@drej/postgres`, or a custom `IStorageAdapter`)
  - `MemoryAdapter`, `NdjsonAdapter`, and the `ledgerDir` shorthand have been removed; drej has no built-in storage opinion
  - Root `build` script added: generates declarations for workspace packages then runs tsup for the SDK

### Patch Changes

- Updated dependencies [5d77498]
  - @drej/opensandbox@0.1.0
