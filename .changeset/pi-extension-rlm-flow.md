---
"drejx": minor
---

Adds `drejx --version`/`-v`/`version`.

`packages/cli/package.json` now declares a `"pi": { "extensions": [...] }` manifest, so `pi install npm:drejx` resolves `pi-extension/drejx.ts` as the extension entry point (Pi's own package manager reads this field — see `resolveExtensionEntries()` in `@earendil-works/pi-coding-agent`'s `package-manager.js`). This is the intended host-level install path: `pi install npm:drejx` puts the extension at Pi's user/global scope, available in every session afterward, rather than the project-local copy `examples/rlm-repo-fanout` still uses today.

The Pi extension itself (`packages/cli/pi-extension/drejx.ts`) gained:
- A `session_start` handler that bootstraps `drejx` (installs it via npm, runs `drejx init`) so a user never has to do either step manually — this extension is meant to be the whole distribution/setup path, not just a tool-wrapper.
- A `before_agent_start` handler that injects `drejx` CLI usage guidance into the system prompt every turn — different guidance depending on whether the current session is itself running inside a drej-managed sandbox (`DREJ_SANDBOX_ID` set, so `drejx fork` is meaningful) or is a host-level session (only `drejx spawn` makes sense). Deliberately dynamic per-turn rather than a static prompt blob baked into one spec.
- An opt-in RLM-orchestrator mindset prompt, gated on a spec setting `DREJX_RLM_MASTER` in its own `env` (so ordinary one-off coding sessions aren't told "you are an orchestrator" unconditionally), with `DREJX_RLM_SYSTEM_PROMPT` as a full override for specs wanting their own wording.

Adds `examples/rlm-master` — a reusable, non-task-specific RLM master spec, in contrast to `examples/rlm-repo-fanout`'s README-backfill-specific one.
