# @drej/postgres

## 0.1.1

### Patch Changes

- 0ea4c33: Rename npm scope from `@drej/*` to `@drejt/*` and add TSDoc to all public API surfaces.

  - All workspace packages now published under `@drejt/*` (e.g. `@drejt/sqlite`, `@drejt/postgres`)
  - `DrejClient`, `WorkflowBuilder`, `SandboxStepBuilder`, `IStorageAdapter`, `LedgerEvent`, `SandboxOpts` and all their members now have hover documentation visible in VS Code

- Updated dependencies [0ea4c33]
  - @drejt/core@0.1.1

## 0.1.0

### Minor Changes

- 82e77fd: Introduce pluggable storage adapter system.

  - `ILedger` renamed to `IStorageAdapter` with optional `connect()` and `close()` lifecycle methods
  - `DrejClientOptions.adapter` accepts any `IStorageAdapter` implementation; `DrejClient` exposes matching `connect()` and `close()` methods
  - New `@drej/postgres` package: `PostgresAdapter` backed by a user-supplied Postgres connection string; owns its schema and runs migrations on `connect()`

### Patch Changes

- Updated dependencies [82e77fd]
- Updated dependencies [5d77498]
  - @drej/core@0.1.0
