---
"@drej/core": minor
"drej": minor
"@drej/postgres": minor
---

Introduce pluggable storage adapter system.

- `ILedger` renamed to `IStorageAdapter` with optional `connect()` and `close()` lifecycle methods
- `DrejClientOptions.adapter` accepts any `IStorageAdapter` implementation; `DrejClient` exposes matching `connect()` and `close()` methods
- New `@drej/postgres` package: `PostgresAdapter` backed by a user-supplied Postgres connection string; owns its schema and runs migrations on `connect()`
