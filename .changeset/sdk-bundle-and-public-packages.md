---
"@drej/core": minor
"@drej/opensandbox": minor
"drej": minor
---

Bundle SDK and publish workspace packages publicly.

- `@drej/core` and `@drej/opensandbox` are now published public packages (previously private workspace-only)
- `drej` SDK ships a pre-built `dist/` with a bundled ESM JS file and a TypeScript declaration file; `"main"` now points to `./dist/index.js`
- `WorkflowDeps.ledger` field renamed to `WorkflowDeps.adapter` for consistency with `IStorageAdapter`
- Root `build` script added: generates declarations for workspace packages then runs tsup for the SDK
