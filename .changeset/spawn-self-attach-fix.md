---
"@drej/agent": patch
"drejx": patch
---

Fix `drejx spawn` when run from inside its own sandbox (the actual `Agent.spawn()` use case): it previously looked up the caller's own running session by name in the local ledger, but a session created via `Agent.load()` from a host process has its `sandbox_created` event recorded in a different `IStorageAdapter` than whatever `drejx spawn` opens from `drej.config.json` inside the container — two independent SQLite files that can never see each other. `drejx spawn` now resolves its own sandbox ID from `DREJ_SANDBOX_ID`, an env var every agent-creation path (`Agent.load()`, `Agent.resume()`, `Agent.spawn()`) now writes to `/etc/drej-env`, falling back to the old ledger lookup only when that's unset.

Also fixes `Agent.attach()` throwing "Unable to connect" on this same self-attach path: it read `/etc/drej-env` via a network exec call to the sandbox's own externally-facing endpoint, which Docker's default bridge network can't hairpin a container back to itself through. When the target sandbox ID matches this process's own `DREJ_SANDBOX_ID`, it now reads the file from the local filesystem directly instead.
