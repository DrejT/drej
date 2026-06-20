# @drej/sqlite

## 0.1.1

### Patch Changes

- 0ea4c33: Rename npm scope from `@drej/*` to `@drejt/*` and add TSDoc to all public API surfaces.

  - All workspace packages now published under `@drejt/*` (e.g. `@drejt/sqlite`, `@drejt/postgres`)
  - `DrejClient`, `WorkflowBuilder`, `SandboxStepBuilder`, `IStorageAdapter`, `LedgerEvent`, `SandboxOpts` and all their members now have hover documentation visible in VS Code

- Updated dependencies [0ea4c33]
  - @drejt/core@0.1.1

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
