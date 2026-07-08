---
"drej": patch
"@drej/agent": minor
"drejx": minor
---

Add `Agent.spawn()`: fork a running agent's live sandbox — filesystem, installed packages, checked-out state — into an independent child running its own Pi bridge, instead of always starting a child from a spec's own snapshot. Exposed via `drejx spawn <name> <child-spec> [--prompt] [--spawn-depth N] [--json]`.

- `AgentSpec` gains an optional `spawnDepth` field, translated by `Agent.load()`/`Agent.resume()` into `DREJX_SPAWN_DEPTH`. `Agent.spawn()` refuses unless this is a positive integer, and force-computes `depth - 1` into the child regardless of what the child's own spec says — a tamper-resistant counter, not something a spec author or the model can hand-propagate incorrectly.
- The child's environment is resolved fresh from its own spec, then every name the parent's own env declares is explicitly `unset` in the exact shell command that starts the child's bridge — verified live that `sb.fork()`'s forked container otherwise carries the parent's env vars forward regardless of what's written to `/etc/drej-env`.
- `Agent.attach()`: connects to a running sandbox without touching its Pi bridge, unlike `resume()` — needed because `drejx spawn` runs as a CLI process invoked by the very Pi bash-tool call it's attaching to; going through `resume()` there would kill the bridge running the process making the call.
- Fixes two pre-existing gaps in `drej`'s `client.restoreSnapshot()` and `client.connect()`, found while building this: neither wired up the `fork` dependency on the `Sandbox` it returned, so `.fork()` (and now `Agent.spawn()`) would throw "fork() is not supported on this sandbox" for any agent loaded from its snapshot fast path, or attached to via `Agent.attach()`. `client.connect()` now accepts an optional `resources` param to enable this.
