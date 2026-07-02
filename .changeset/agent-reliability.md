---
"@drej/agent": patch
---

Fix extension_ui_request bug and add auto-retry API

- **Bug fix**: `extension_ui_request` events from Pi extensions were silently dropped by the bridge. Dialog requests (select/confirm/input/editor) now receive an immediate `cancelled` response so Pi never stalls indefinitely. All extension UI events are forwarded through the stream as a new `extension_ui` AgentEvent.

- **New**: `agent.setAutoRetry(enabled)` — enable or disable Pi's built-in exponential-backoff retry on transient errors (429, 5xx). On by default (3 attempts, 2 s / 4 s / 8 s).

- **New**: `agent.abortRetry()` — abort an in-progress retry immediately.

- **New events**: `auto_retry_start` and `auto_retry_end` are now forwarded through the AgentStream with full context (attempt, maxAttempts, delayMs, errorMessage, finalError).
