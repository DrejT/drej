---
"drej": minor
"@drej/core": minor
"@drej/opensandbox": patch
---

Add per-step timeout support

Steps now accept `timeoutMs` to cap execution time. When exceeded, the step
fails with `StepTimeoutError` and rollback runs automatically. A global default
can be set via `RunOptions.stepTimeoutMs` as a safety net for all steps.

The timeout is wired through a per-step `AbortController` scoped to both
`ControlClient` and `ExecClient`, so in-flight HTTP calls and SSE streams are
cancelled cleanly when the timer fires.
