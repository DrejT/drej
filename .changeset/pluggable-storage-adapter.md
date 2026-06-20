---
"@drej/core": minor
"drej": minor
"@drej/postgres": minor
---

Introduce pluggable storage adapter system.

- `ILedger` renamed to `IStorageAdapter` with optional `connect()` and `close()` lifecycle methods
- Built-in implementations renamed: `MemoryLedger` → `MemoryAdapter`, `NdjsonLedger` → `NdjsonAdapter`
- `DrejClientOptions` gains an `adapter` field accepting any `IStorageAdapter` implementation
- `DrejClient` gains `connect()` and `close()` methods for adapter lifecycle management
- New `@drej/adapter-postgres` package: `PostgresAdapter` backed by a user-supplied Postgres connection string; owns its schema and runs migrations on `connect()`
