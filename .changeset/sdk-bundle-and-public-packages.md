---
"@drej/core": minor
"@drej/opensandbox": minor
"drej": minor
---

Bundle SDK, publish workspace packages publicly, and make adapter required.

- `@drej/core` and `@drej/opensandbox` are now published public packages (previously private workspace-only)
- `drej` SDK ships a pre-built `dist/` with a bundled ESM JS file and TypeScript declarations; `"main"` now points to `./dist/index.js`
- `WorkflowDeps.ledger` field renamed to `WorkflowDeps.adapter`
- `DrejClientOptions.adapter` is now **required** — callers must supply a storage adapter (`@drej/sqlite`, `@drej/postgres`, or a custom `IStorageAdapter`)
- `MemoryAdapter`, `NdjsonAdapter`, and the `ledgerDir` shorthand have been removed; drej has no built-in storage opinion
- Root `build` script added: generates declarations for workspace packages then runs tsup for the SDK
