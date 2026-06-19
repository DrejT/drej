---
"drej": patch
---

feat: lifecycle hooks, append-only WAL, and clean adapter layer

- Add `WorkflowHooks` interface with `onStepStart`, `onStepComplete`, `onStepFailed`, `onStepRolledBack`, `onWorkflowComplete`, `onWorkflowFailed` callbacks on `WorkflowDeps`
- Fix `NdjsonLedger.append` to use `appendFileSync` (O_APPEND) instead of read-then-overwrite (O_TRUNC), preventing ledger truncation on crash
- Make `NdjsonLedger.readAll` resilient to malformed lines from partial writes
- Add `OpenSandboxControlAdapter` and `OpenSandboxExecFactory` to `@drej/opensandbox` — concrete implementations of `ISandboxControl` and `IExecClientFactory` that encapsulate execd readiness polling
- Remove `as unknown as` double-cast from `apps/api`; adapter wiring is now explicit and type-safe
