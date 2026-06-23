---
"drej": minor
---

Remove `client.connect()` and `client.close()` from the public API. The adapter is now initialised lazily on first use and closed automatically via `process.on("beforeExit")`. Existing calls to these methods should simply be removed.
