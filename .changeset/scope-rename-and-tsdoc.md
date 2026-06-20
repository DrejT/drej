---
"@drejt/core": patch
"@drejt/opensandbox": patch
"@drejt/sqlite": patch
"@drejt/postgres": patch
"drej": patch
---

Rename npm scope from `@drej/*` to `@drejt/*` and add TSDoc to all public API surfaces.

- All workspace packages now published under `@drejt/*` (e.g. `@drejt/sqlite`, `@drejt/postgres`)
- `DrejClient`, `WorkflowBuilder`, `SandboxStepBuilder`, `IStorageAdapter`, `LedgerEvent`, `SandboxOpts` and all their members now have hover documentation visible in VS Code
