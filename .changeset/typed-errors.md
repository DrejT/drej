---
"drej": minor
"@drejt/core": minor
---

Add typed workflow errors: `SandboxError`, `ExecConnectionError`, `CommandError`.

Infra failures (sandbox boot failure, execd connection timeout) now throw typed errors instead of generic `Error`. Add `strict` option to `exec()` — when enabled, a non-zero exit code throws `CommandError` with the exit code attached. Errors propagate through the `WorkflowRun` async iterator so callers can catch them with a standard `try/catch` around the `for await` loop. All failures continue to be recorded in the ledger via `LedgerEvent.StepFailed`.
