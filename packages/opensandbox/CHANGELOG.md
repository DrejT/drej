# @drej/opensandbox

## 0.1.3

### Patch Changes

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

## 0.1.2

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

## 0.1.1

### Patch Changes

- 0ea4c33: Rename npm scope from `@drej/*` to `@drej/*` and add TSDoc to all public API surfaces.

  - All workspace packages now published under `@drej/*` (e.g. `@drej/sqlite`, `@drej/postgres`)
  - `DrejClient`, `WorkflowBuilder`, `SandboxStepBuilder`, `IStorageAdapter`, `LedgerEvent`, `SandboxOpts` and all their members now have hover documentation visible in VS Code

## 0.1.0

### Minor Changes

- 5d77498: Bundle SDK, publish workspace packages publicly, and make adapter required.

  - `@drej/core` and `@drej/opensandbox` are now published public packages (previously private workspace-only)
  - `drej` SDK ships a pre-built `dist/` with a bundled ESM JS file and TypeScript declarations; `"main"` now points to `./dist/index.js`
  - `WorkflowDeps.ledger` field renamed to `WorkflowDeps.adapter`
  - `DrejClientOptions.adapter` is now **required** — callers must supply a storage adapter (`@drej/sqlite`, `@drej/postgres`, or a custom `IStorageAdapter`)
  - `MemoryAdapter`, `NdjsonAdapter`, and the `ledgerDir` shorthand have been removed; drej has no built-in storage opinion
  - Root `build` script added: generates declarations for workspace packages then runs tsup for the SDK
