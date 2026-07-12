---
"@drej/opensandbox": patch
"@drej/core": patch
"drej": patch
---

Cancel the exec/code SSE stream as soon as the terminal event (`execution_complete` or `error`) arrives instead of reading until the server closes the connection. execd holds the HTTP stream open for a fixed interval after sending its last event, so every `exec()`/`execCode()`/session command was paying that delay on top of the real round trip — this cuts steady-state exec latency from roughly 1 second to tens of milliseconds.

Also switch the fixed-interval polling in `waitForRunning`, `waitForSnapshot`, and `resolveExecClient` to start fast and back off toward the original interval, instead of sleeping the full interval on every tick regardless of how quickly the real state change lands. Measured against a local OpenSandbox server, this cut checkpoint latency from ~2s to ~300-500ms.
