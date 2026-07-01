---
"drej": minor
"@drej/core": minor
"@drej/opensandbox": minor
"@drej/agent": minor
---

Sandbox API extensions: `pause()` / `resume()`, `createSession()` / `BashSession` persistent shell sessions, `diagnosticLogs()` / `diagnosticEvents()`, `watchMetrics()` streaming, and `Drej.connect()` for attaching to an already-running container. Agent: `Agent.resume(sandboxId)` to reconnect a new host process to a live agent sandbox (restarts the bridge with `--continue`).
