---
"drej": minor
"@drej/core": minor
"@drej/opensandbox": patch
---

Add per-step timeout and AbortSignal cancellation

**Per-step timeouts**: steps now accept `timeoutMs` to cap execution time. A
global fallback can be set via `RunOptions.stepTimeoutMs`. When exceeded, the
step fails with `StepTimeoutError` and rollback runs automatically.

**Cancellation**: `WorkflowRun.cancel()` aborts the run immediately. Breaking
out of the `for await` loop does the same. Pass `RunOptions.signal` to wire in
an external `AbortController` or `AbortSignal.timeout()`.

Both features share the same internal mechanism: a per-step `AbortController`
scoped to both `ControlClient` and `ExecClient` via `withSignal()`, so
in-flight HTTP calls and SSE exec streams are cancelled cleanly at the fetch
level. Rollback still runs with unscoped clients to ensure cleanup always
completes.
