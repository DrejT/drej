# @drej/sqlite

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
