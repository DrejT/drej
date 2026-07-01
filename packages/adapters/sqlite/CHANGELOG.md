# @drej/sqlite

## 0.3.1

### Patch Changes

- a0c1eee: Add README to each published package so npm shows documentation on the package page.
- Updated dependencies [f803858]
- Updated dependencies [c81c77d]
  - @drej/core@0.5.0

## 0.3.0

### Minor Changes

- 5a63143: Add named checkpoints: `sb.listCheckpoints()` returns all checkpoints in creation order with `snapshotId`, `tag`, and `createdAt`. `client.resume(id, { tag })` resumes from a specific named checkpoint instead of the most recent. New exported types: `CheckpointInfo`, `ResumeOptions`. Storage adapters gain `listCheckpoints()`.
- 2ed4de7: Add sandbox environments: define a named environment with a setup recipe, build it once into a snapshot, and spawn cheap isolated sandboxes from it on demand. New API: `client.environment(name, opts)` returns an `Environment` with `.sandbox()`, `.rebuild()`, and `.info()`. `client.environments.list/delete` manage cached records. Storage adapters gain `getEnvironment`, `saveEnvironment`, `deleteEnvironment`, `listEnvironments`.
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

- Updated dependencies [10417e3]
- Updated dependencies [416bc72]
- Updated dependencies [2bbd8dc]
  - @drej/core@0.4.0

## 0.2.0

### Minor Changes

- 2fd33e0: feat: run management API

  Add `RunStatus` enum, `RunDetails` type, and `ListRunsOptions` for filtering. Replace `listRuns()` with `listRunDetails()`, `listAllRunDetails()`, `getRunDetails()`, and `deleteRun()` on both `IStorageAdapter` and `DrejClient`. Add `WorkflowRun.status` property that tracks execution state as events are consumed.

### Patch Changes

- Updated dependencies [22b8a32]
- Updated dependencies [799b6dd]
- Updated dependencies [8d9d8bb]
- Updated dependencies [2fd33e0]
- Updated dependencies [0d94c2a]
  - @drej/core@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [4c0ad93]
- Updated dependencies [b04f8eb]
- Updated dependencies [a971b7b]
- Updated dependencies [ce173be]
- Updated dependencies [86c2dde]
- Updated dependencies [82094ae]
  - @drej/core@0.2.0

## 0.1.1

### Patch Changes

- 0ea4c33: Rename npm scope from `@drej/*` to `@drej/*` and add TSDoc to all public API surfaces.

  - All workspace packages now published under `@drej/*` (e.g. `@drej/sqlite`, `@drej/postgres`)
  - `DrejClient`, `WorkflowBuilder`, `SandboxStepBuilder`, `IStorageAdapter`, `LedgerEvent`, `SandboxOpts` and all their members now have hover documentation visible in VS Code

- Updated dependencies [0ea4c33]
  - @drej/core@0.1.1

## 0.1.0

### Minor Changes

- 5d77498: Introduce `@drej/sqlite` storage adapter.

  `SQLiteAdapter` implements `IStorageAdapter` via Bun's built-in `bun:sqlite` — zero extra dependencies and no infrastructure required. Data persists across restarts, making it suitable for local development and single-process production workloads.

  ```ts
  import { DrejClient } from "drej";
  import { SQLiteAdapter } from "@drej/sqlite";

  const client = new DrejClient({
    baseUrl: "http://localhost:8080",
    adapter: new SQLiteAdapter("./drej.db"),
  });
  await client.connect();
  ```

  WAL mode is enabled on `connect()` for safe concurrent reads alongside ongoing writes.

### Patch Changes

- Updated dependencies [82e77fd]
- Updated dependencies [5d77498]
  - @drej/core@0.1.0
