---
"drejx": minor
---

Add tmux-style session commands: `drejx run <spec> [--detach] [--rebuild]`, `drejx ps`, `drejx attach <name>`, `drejx kill <name>`, `drejx logs <name>`. Bare `drejx` in a terminal now launches an interactive TUI (built on `@opentui/core`) with a dashboard of running sessions and a chat view. Existing `init`/`add`/`list`/`remove` commands are unchanged.
