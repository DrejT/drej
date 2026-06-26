---
"@drej/core": patch
"drej": patch
---

Remove `SandboxStatus.Failed` and `SandboxStatus.Cancelled` enum values and `SandboxDetails.error` field — these were never derivable from ledger events and could not be produced by any code path.
