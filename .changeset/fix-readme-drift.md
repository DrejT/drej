---
"drejx": patch
"@drej/agent": patch
---

Docs only, no code change. `packages/cli/README.md` had drifted badly — it
documented only 4 of 10 commands (`init`/`add`/`list`/`remove`), leaving the
entire "Agent — session lifecycle" group (`spawn`/`prompt`/`fork`/`agents`/
`kill`/`logs`) undocumented, and described `drejx list`/`drejx remove` as
operating on a `.drej/sandboxes.json` file that no longer exists. Rewrote it
to cover every command, the `spawnDepth`/`maxAgents` recursive-spawning
semantics, and the `pi install npm:drejx` distribution path.

`packages/agent/README.md` was missing `Agent.attach()` and `agent.spawn()`
entirely — the sandbox-level forking capability — despite otherwise being
accurate. Added both, plus the `spawnDepth`/`maxAgents` spec fields to the
Agent spec table.

Root `README.md`'s packages table was missing `@drej/flue` — same drift
pattern already fixed in `CLAUDE.md` during the codebase restructure, just
never applied here.
