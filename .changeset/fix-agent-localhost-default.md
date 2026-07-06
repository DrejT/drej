---
"@drej/agent": patch
---

Default `serverUrl` (in `drej.config.json` / `readProjectConfig`) is now `http://127.0.0.1:8080` instead of `http://localhost:8080`. On hosts where `localhost` resolves to `::1` first but OpenSandbox only listens on IPv4, the old default caused every request — including `Agent.load()`'s sandbox creation — to fail with a socket error instead of connecting.
