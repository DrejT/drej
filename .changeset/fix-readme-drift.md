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

Also fixed a longstanding bug (present since the README's first commit, well
before this session): every `Agent.load()`/`Agent.resume()` example across
`packages/agent/README.md` and the docs site omitted the required
`opts.adapter` field, so copy-pasting any of them would fail to compile.
`@drej/agent` deliberately has no storage-adapter dependency of its own — the
fix is docs-only (construct a `SQLiteAdapter`/`PostgresAdapter` explicitly in
every example), not a behavior change to the SDK itself.

Docs site (`apps/docs/`, not a published package) also updated to match:
added the 6 missing `drejx` command pages (`spawn`/`prompt`/`fork`/`agents`/
`kill`/`logs`), `Agent.attach()`/`agent.spawn()` in the API reference, and
corrected several pages that still claimed "drejx never touches a sandbox" —
no longer true since it gained a full agent-session-lifecycle command group.
