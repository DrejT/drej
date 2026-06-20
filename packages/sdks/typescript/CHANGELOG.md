# drej

## 0.5.1

### Patch Changes

- 0ea4c33: Rename npm scope from `@drej/*` to `@drejt/*` and add TSDoc to all public API surfaces.

  - All workspace packages now published under `@drejt/*` (e.g. `@drejt/sqlite`, `@drejt/postgres`)
  - `DrejClient`, `WorkflowBuilder`, `SandboxStepBuilder`, `IStorageAdapter`, `LedgerEvent`, `SandboxOpts` and all their members now have hover documentation visible in VS Code

- Updated dependencies [0ea4c33]
  - @drejt/core@0.1.1
  - @drejt/opensandbox@0.1.1

## 0.5.0

### Minor Changes

- 5f55b31: Remove the HTTP API layer. `DrejClient` now runs workflows in-process directly against OpenSandbox — no separate `drej` server required.

  **Breaking change:** `DrejClientOptions.baseUrl` now points at your OpenSandbox server (e.g. `http://localhost:8080`), not the drej API. Add `apiKey` for your OpenSandbox API key.

  ```ts
  // Before
  const client = new DrejClient({ baseUrl: "http://localhost:6000" });

  // After
  const client = new DrejClient({
    baseUrl: "http://localhost:8080",
    apiKey: "",
  });
  ```

  All workflow execution (`run`, `replayFromSnapshot`, `resumeRun`), sandbox management, and snapshot management methods are unchanged. Add `ledgerDir` to persist the run ledger to disk across restarts.

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

- Updated dependencies [82e77fd]
- Updated dependencies [5d77498]
  - @drej/core@0.1.0
  - @drej/opensandbox@0.1.0

## 0.4.0

### Minor Changes

- d0486df: Add fluent workflow builder API to TypeScript SDK.

  `workflow(id)` returns a `WorkflowBuilder` with chainable `.sandbox()` and `.parallel()` methods. Inside a sandbox scope, `SandboxStepBuilder` provides `.exec()`, `.writeFile()`, `.retry()`, `.forEach()`, `.when()`, and `.parallel()`. The `forEach` callback receives `(s, item)` where `item` serialises to `{{name}}` in template literals, enabling natural JS interpolation. Top-level `.parallel()` supports multiple concurrent sandbox sessions via `WorkflowParallelBuilder`. `DrejClient.run(w)` accepts a built workflow directly. The `sandbox()` helper defaults the entrypoint to `["tail", "-f", "/dev/null"]`.

  Adds a server-side `sequence` step type that runs child steps sequentially, used internally by the builder to represent multi-step parallel branches.

- e1f9bb8: Add `snapshotConfig` option to `client.run()` and a `replayFromSnapshot()` method.

  Pass `snapshotConfig: { afterSteps?: number[]; everyNSteps?: number }` to capture sandbox snapshots at specific points in a workflow. Call `client.replayFromSnapshot(name, runId, workflow)` to start a new run booted from the latest captured snapshot — skipping any setup steps already baked into the image.

- 9a30c31: Introduce per-run ledger with workflow name / run ID separation.

  Each workflow execution now has a stable **workflow name** (user-defined) and an auto-generated **run ID** (UUID). Ledger files are stored at `ledgers/<name>/<runId>.ndjson` so all runs of a workflow are grouped together.

  API changes:

  - `POST /v1/workflows/:name/runs` — starts a run; first SSE event is `run_started` carrying the run ID
  - `POST /v1/workflows/:name/runs/:runId/resume` — resumes a specific run
  - `GET /v1/workflows/:name/runs` — lists all run IDs for a workflow
  - `GET /v1/workflows/:name/runs/:runId/ledger` — fetches ledger for a specific run

  SDK changes:

  - `client.run(w)` is now `async` and returns `Promise<WorkflowRun>`; `run.id` gives the run ID, `run.name` the workflow name, and it is async-iterable for events
  - `client.resumeRun(name, runId, w)` resumes a run
  - `client.listWorkflowRuns(name)` lists runs
  - `client.getWorkflowLedger(name, runId)` fetches the ledger
  - `WorkflowEvent` fields renamed: `workflowId` → `workflowName` + `runId`

### Patch Changes

- b3c0bc9: feat: lifecycle hooks, append-only WAL, and clean adapter layer

  - Add `WorkflowHooks` interface with `onStepStart`, `onStepComplete`, `onStepFailed`, `onStepRolledBack`, `onWorkflowComplete`, `onWorkflowFailed` callbacks on `WorkflowDeps`
  - Fix `NdjsonLedger.append` to use `appendFileSync` (O_APPEND) instead of read-then-overwrite (O_TRUNC), preventing ledger truncation on crash
  - Make `NdjsonLedger.readAll` resilient to malformed lines from partial writes
  - Add `OpenSandboxControlAdapter` and `OpenSandboxExecFactory` to `@drejt/opensandbox` — concrete implementations of `ISandboxControl` and `IExecClientFactory` that encapsulate execd readiness polling
  - Remove `as unknown as` double-cast from `apps/api`; adapter wiring is now explicit and type-safe

## 0.3.0

### Minor Changes

- 6256955: Add retry, conditional, loop, and parallel step types to the workflow engine.

  - `retry` — retries a child step up to N times with fixed or exponential backoff
  - `conditional` — branches on a structured predicate (`eq`, `neq`, `gt`, `lt`, `exists`, `and`, `or`) evaluated against workflow state
  - `loop` — iterates over a static `items` array or a dot-path `over` pointing to an array in state; supports `concurrently` flag for parallel iterations
  - `parallel` — fans out multiple steps with `Promise.all`; emits events with a `branch` index for demuxing
  - `{{key}}` interpolation in `exec_command` so loop items and other state values can be referenced in command strings
  - `branch` field added to `WorkflowEvent` to identify parallel branch origin
  - `Predicate` type exported from the SDK for use with `conditional` steps

- 2da4112: Add workflow engine support: `runWorkflow()` now supports `create_sandbox`, `exec_code`, `exec_command`, and `delete_sandbox` step types with SSE streaming and saga rollback.
- eb72eea: Add `write_file` workflow step type and always base64-encode `exec_command` strings.

  - `write_file` step writes text or binary content to a path inside the sandbox; accepts `encoding: "utf8"` (default) or `"base64"` for binary files
  - `exec_command` now unconditionally base64-encodes the command string before sending to the container, eliminating all quoting and special-character edge cases

## 0.2.1

### Patch Changes

- 5278aa9: Add `DrejError` and `run()` to the Python SDK, matching the TypeScript SDK's interface.

## 0.2.0

### Minor Changes

- c3fe034: Add `DrejClient.run(code)` method and `SandboxRunResult` type for submitting code to the sandbox execution endpoint.

### Patch Changes

- 3316570: Add `DrejError` class with HTTP status code — errors from API calls now throw `DrejError` instead of a generic `Error`.
