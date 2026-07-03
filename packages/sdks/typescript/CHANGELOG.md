# drej

## 0.9.1

### Patch Changes

- 34cfa8b: Add the missing `license` field (Apache-2.0) to every published package's `package.json`, matching the repo's root `LICENSE` file.
- bca2a6b: Fix JSDoc comments that no longer matched the code they document (stale `DrejClient` references, incorrect claims about `DrejError`, `watchMetrics()`, `resume()`, `exec()` ledger logging, `CommandError`, `computeSetupHash`, `bash()` streaming, and the `when()` predicate context), and flag two fields (`AgentSpec.cliVersion`, `.metadata`, `.registryDependencies`) and one known concurrency limitation (`FlushContext` under `forEach({ concurrency > 1 })`) that are currently no-ops/buggy rather than doing what they were documented to do. No behavior changes — doc-only.
- 3f362d1: Enable npm provenance for published packages.
- Updated dependencies [34cfa8b]
- Updated dependencies [bca2a6b]
- Updated dependencies [3f362d1]
  - @drej/core@0.5.1
  - @drej/opensandbox@0.2.1

## 0.9.0

### Minor Changes

- f803858: Agent snapshotting: `Agent.load()` checkpoints the sandbox after Pi install and restores from the snapshot on subsequent loads, reducing startup from ~90s to ~8s. `checkpoint()` now returns the snapshot ID. New `Drej.restoreSnapshot(snapshotId, name, resources)` creates a sandbox from a snapshot without exec replay. `Agent.load()` accepts `{ rebuild: true }` to force reinstall.
- c81c77d: Sandbox API extensions: `pause()` / `resume()`, `createSession()` / `BashSession` persistent shell sessions, `diagnosticLogs()` / `diagnosticEvents()`, `watchMetrics()` streaming, and `Drej.connect()` for attaching to an already-running container. Agent: `Agent.resume(sandboxId)` to reconnect a new host process to a live agent sandbox (restarts the bridge with `--continue`).

### Patch Changes

- a0c1eee: Add README to each published package so npm shows documentation on the package page.
- Updated dependencies [f803858]
- Updated dependencies [c81c77d]
  - @drej/core@0.5.0
  - @drej/opensandbox@0.2.0

## 0.8.0

### Minor Changes

- 5a63143: Add named checkpoints: `sb.listCheckpoints()` returns all checkpoints in creation order with `snapshotId`, `tag`, and `createdAt`. `client.resume(id, { tag })` resumes from a specific named checkpoint instead of the most recent. New exported types: `CheckpointInfo`, `ResumeOptions`. Storage adapters gain `listCheckpoints()`.
- f83ccf2: Remove `client.connect()` and `client.close()` from the public API. The adapter is now initialised lazily on first use and closed automatically via `process.on("beforeExit")`. Existing calls to these methods should simply be removed.
- 0398728: Rename `DrejClient` → `Drej` and `DrejClientOptions` → `DrejOptions`. Add `WorkflowRun.stdout()`, `WorkflowRun.result()`, and `WorkflowRun.pipe()` for ergonomic output consumption without manual event filtering.
- 4f79c8e: Make `resources` required in `SandboxOptions` (`cpu` and `memory` are now required fields). The OpenSandbox server rejects requests without resource limits — this makes the constraint explicit at the type level.
- 2ed4de7: Add sandbox environments: define a named environment with a setup recipe, build it once into a snapshot, and spawn cheap isolated sandboxes from it on demand. New API: `client.environment(name, opts)` returns an `Environment` with `.sandbox()`, `.rebuild()`, and `.info()`. `client.environments.list/delete` manage cached records. Storage adapters gain `getEnvironment`, `saveEnvironment`, `deleteEnvironment`, `listEnvironments`.
- 02bcb01: Add `sb.fork(tag?)`: snapshot a live sandbox and return a new independent `Sandbox` from that state without closing the original. The forked sandbox gets its own ledger session and concurrency slot. The fork checkpoint is visible in `sb.listCheckpoints()` and usable with `client.resume()`.
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

- 599d707: Surface OpenSandbox exec and file-system capabilities on the public `Sandbox` API:

  - `sb.exec(cmd, { timeoutMs })` — abort commands after N milliseconds
  - `sb.proxy(port)` — get a proxied URL and auth headers for an in-sandbox port
  - `sb.metrics()` — return current CPU and memory usage
  - `sb.createDirectory(path)` / `sb.deleteDirectory(path)` — direct directory operations
  - `sb.getFileInfo(path)` — file metadata (size, type, mode, timestamps)
  - `sb.replaceInFiles(replacements)` — targeted in-place multi-file string replacement
  - `sb.transfer(path, target)` — copy a file between two `Sandbox` instances
  - `client.sandbox({ metadata })` — attach arbitrary key-value labels at sandbox creation
  - `FileInfo` is now exported from `drej`

### Patch Changes

- 10417e3: feat: add drejx CLI with Docker-based OpenSandbox init and registry support; add useServerProxy option to Drej client
- 416bc72: Remove `SandboxStatus.Failed` and `SandboxStatus.Cancelled` enum values and `SandboxDetails.error` field — these were never derivable from ledger events and could not be produced by any code path.
- Updated dependencies [10417e3]
- Updated dependencies [416bc72]
- Updated dependencies [2bbd8dc]
  - @drej/core@0.4.0
  - @drej/opensandbox@0.1.4

## 0.7.0

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

- 55259b7: Replace `ref()` / `as:` with imperative builder that returns typed refs inline.

  Output-producing methods (`readFile`, `searchFiles`, `listDirectory`, `getFileInfo`, `exec` with `capture: true`) now return a `Ref<T>` directly — no pre-declaration or `as:` option needed. Use the returned variable in template literals to interpolate values in later steps.

  ```ts
  // before
  const files = ref<string[]>("files");
  s.searchFiles("*.ts", { as: files, dir: "/src" }).exec(`echo ${files}`);

  // after
  const files = s.searchFiles("*.ts", { dir: "/src" });
  s.exec(`echo ${files}`);
  ```

  Breaking changes:

  - `ref()`, `Ref`, `refKey`, `refStr` removed from public API
  - `as:` option removed from all output methods
  - `exec` capture changes from `{ capture: "name" }` to `{ capture: true }` (returns `Ref<string>`)
  - Callback signatures for `sandbox`, `retry`, `when`, `parallel`, `forEach` change return type from `SandboxStepBuilder` to `void`

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

- Updated dependencies [22b8a32]
- Updated dependencies [799b6dd]
- Updated dependencies [8d9d8bb]
- Updated dependencies [2fd33e0]
- Updated dependencies [0d94c2a]
  - @drej/core@0.3.0
  - @drej/opensandbox@0.1.3

## 0.6.0

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

- b04f8eb: Add `execCode()` to the workflow builder and expose exit code in workflow state.

  `SandboxStepBuilder.execCode()` lets you run code directly (Python, Node.js, etc.)
  via execd's code interpreter — with optional stateful context to share variables
  across calls. Previously only shell commands (`exec()`) were available in the builder.

  `exec()` now captures the command exit code from the SSE stream and sets
  `exitCode` on workflow state after each step. This makes `when({ field: "exitCode" })`
  predicates actually useful for branching on command success or failure.

  `CodeContext` is now exported from the `drej` package for consumers who want to
  type context options explicitly.

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

- Updated dependencies [4c0ad93]
- Updated dependencies [b04f8eb]
- Updated dependencies [a971b7b]
- Updated dependencies [ce173be]
- Updated dependencies [86c2dde]
- Updated dependencies [82094ae]
  - @drej/core@0.2.0
  - @drej/opensandbox@0.1.2

## 0.5.1

### Patch Changes

- 0ea4c33: Rename npm scope from `@drej/*` to `@drej/*` and add TSDoc to all public API surfaces.

  - All workspace packages now published under `@drej/*` (e.g. `@drej/sqlite`, `@drej/postgres`)
  - `DrejClient`, `WorkflowBuilder`, `SandboxStepBuilder`, `IStorageAdapter`, `LedgerEvent`, `SandboxOpts` and all their members now have hover documentation visible in VS Code

- Updated dependencies [0ea4c33]
  - @drej/core@0.1.1
  - @drej/opensandbox@0.1.1

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
  - Add `OpenSandboxControlAdapter` and `OpenSandboxExecFactory` to `@drej/opensandbox` — concrete implementations of `ISandboxControl` and `IExecClientFactory` that encapsulate execd readiness polling
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
