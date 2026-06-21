---
"@drej/core": minor
"@drej/postgres": minor
"@drej/sqlite": minor
"drej": minor
---

feat: run management API

Add `RunStatus` enum, `RunDetails` type, and `ListRunsOptions` for filtering. Replace `listRuns()` with `listRunDetails()`, `listAllRunDetails()`, `getRunDetails()`, and `deleteRun()` on both `IStorageAdapter` and `DrejClient`. Add `WorkflowRun.status` property that tracks execution state as events are consumed.
