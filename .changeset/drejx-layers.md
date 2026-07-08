---
"drejx": minor
---

Restructure `drejx` into three clean layers per `plans/drejx-layers.md`:

- **CLI**: renamed `ps` → `agents`, removed the interactive `attach` REPL, added
  `drejx prompt <name> <message>` (send one message to a running session, get the
  reply, no terminal needed), and `--json` on `run`/`prompt`/`agents`/`logs` for
  machine-readable output. `run` no longer attaches interactively — it starts a
  session, optionally sends a first prompt via `--prompt`, and exits.
- **TUI**: bare `drejx` now includes a new-session launcher (browse local specs +
  the registry.drej.dev catalog, pick one, it fetches and runs) and a logs view,
  alongside the existing dashboard and chat view. The dashboard also gains a
  `k` kill action.
- **Pi extension**: `packages/cli/pi-extension/drejx.ts`, shipped with the npm
  package, registers `drejx_run`/`drejx_prompt`/`drejx_agents`/`drejx_kill` as
  typed Pi tools — lets a Pi agent orchestrate child drejx sessions without
  hand-rolling `osb` bash commands.

Breaking CLI changes (`ps` renamed, `attach` removed) — low-stakes since `drejx`
has no meaningful external adoption yet.
