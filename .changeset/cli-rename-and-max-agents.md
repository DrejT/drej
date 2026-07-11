---
"drejx": minor
"@drej/agent": minor
---

Renamed CLI commands: `drejx run` → `drejx spawn` (start a fresh, independent agent sandbox from a spec), and the previous `drejx spawn` (fork a running session's own live sandbox into a child) → `drejx fork`. "Spawn" now consistently means "create," matching how it reads; "fork" now names the operation that actually forks live state, matching `Agent.spawn()`'s own doc language.

Renamed `--spawn-depth` to `--depth` on `spawn`/`fork` (POSIX-style, and paired now with the new `--max` flag below).

Added a `--max` flag (and matching `maxAgents` spec field) — a separate, optional ceiling on total descendants for a lineage, distinct from `--depth`'s nesting-depth limit. Unset means uncapped for this dimension; `--depth` alone still gates whether spawning/forking is allowed at all. Enforced per-lineage only — sibling branches forked in parallel don't share or coordinate this budget with each other. Implemented the same tamper-resistant env-counter pattern as `spawnDepth`/`DREJX_SPAWN_DEPTH`, via a new `DREJX_MAX_AGENTS` env var.

`drejx prompt`/`drejx kill`'s `--spec`-adjacent internals and the Pi extension's `drejx_run` tool are updated to `drejx_spawn` to match the rename.

`drejx agents` now cross-checks the ledger's "Running" sandboxes against the live OpenSandbox control plane before listing them — a sandbox that died ungracefully (crashed, expired via OpenSandbox's own TTL, deleted outside drej) previously stayed listed as "Running" forever, since nothing ever told the ledger otherwise.
