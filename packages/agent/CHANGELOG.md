# @drej/agent

## 0.6.0

### Minor Changes

- 7bd8e5d: Renamed CLI commands: `drejx run` → `drejx spawn` (start a fresh, independent agent sandbox from a spec), and the previous `drejx spawn` (fork a running session's own live sandbox into a child) → `drejx fork`. "Spawn" now consistently means "create," matching how it reads; "fork" now names the operation that actually forks live state, matching `Agent.spawn()`'s own doc language.

  Renamed `--spawn-depth` to `--depth` on `spawn`/`fork` (POSIX-style, and paired now with the new `--max` flag below).

  Added a `--max` flag (and matching `maxAgents` spec field) — a separate, optional ceiling on total descendants for a lineage, distinct from `--depth`'s nesting-depth limit. Unset means uncapped for this dimension; `--depth` alone still gates whether spawning/forking is allowed at all. Enforced per-lineage only — sibling branches forked in parallel don't share or coordinate this budget with each other. Implemented the same tamper-resistant env-counter pattern as `spawnDepth`/`DREJX_SPAWN_DEPTH`, via a new `DREJX_MAX_AGENTS` env var.

  `drejx prompt`/`drejx kill`'s `--spec`-adjacent internals and the Pi extension's `drejx_run` tool are updated to `drejx_spawn` to match the rename.

  `drejx agents` now cross-checks the ledger's "Running" sandboxes against the live OpenSandbox control plane before listing them — a sandbox that died ungracefully (crashed, expired via OpenSandbox's own TTL, deleted outside drej) previously stayed listed as "Running" forever, since nothing ever told the ledger otherwise.

### Patch Changes

- e343eab: Internal restructure: extract the ~540-line Node.js bridge script out of
  `packages/agent/src/adapters/pi.ts`'s `BRIDGE_SCRIPT` template literal into a
  real file, `packages/agent/src/adapters/pi-bridge.js` — it now gets actual
  lint/format coverage instead of living as an opaque string with zero tooling
  support. Read at runtime relative to its own module location and copied
  into `dist/` alongside `index.mjs` by tsdown's `copy` config, so resolution
  works identically in dev and the published package. (Bun's native text
  import attribute was tried first but isn't understood by rolldown, the
  bundler this package's publish build actually uses.)

  No behavior change — the bridge script's content is byte-identical, verified
  by evaluating the original template literal and diffing against the
  extracted file before making the switch. Part of the codebase restructure
  plan (plans/codebase-restructure.md, Phase 4).

- e78be8b: Fix the Pi bridge's `/prompt` and `/bash` SSE responses dying on OpenSandbox's generic port-proxy: that endpoint proxies through an httpx client with no configured read timeout (defaults to 5s), so any gap that long between bytes written — model thinking time, a slow tool call — got the proxy's connection killed, surfacing as a 500 or a silently-truncated stream. A periodic `: ping` SSE comment now keeps that idle timer from firing during long-running prompts and bash calls.
- e78be8b: Fix the Pi bridge silently dropping a rejected `/prompt` call. When Pi rejects a prompt outright (e.g. no API key configured for the provider), its ack isn't tracked the way `/bash` results are, so the bridge previously just discarded it — the client's SSE stream would sit open indefinitely (kept alive by the heartbeat) instead of ever completing. The bridge now forwards the rejection as an error and ends the stream immediately.
- e78be8b: Fix `drejx spawn` when run from inside its own sandbox (the actual `Agent.spawn()` use case): it previously looked up the caller's own running session by name in the local ledger, but a session created via `Agent.load()` from a host process has its `sandbox_created` event recorded in a different `IStorageAdapter` than whatever `drejx spawn` opens from `drej.config.json` inside the container — two independent SQLite files that can never see each other. `drejx spawn` now resolves its own sandbox ID from `DREJ_SANDBOX_ID`, an env var every agent-creation path (`Agent.load()`, `Agent.resume()`, `Agent.spawn()`) now writes to `/etc/drej-env`, falling back to the old ledger lookup only when that's unset.

  Also fixes `Agent.attach()` throwing "Unable to connect" on this same self-attach path: it read `/etc/drej-env` via a network exec call to the sandbox's own externally-facing endpoint, which Docker's default bridge network can't hairpin a container back to itself through. When the target sandbox ID matches this process's own `DREJ_SANDBOX_ID`, it now reads the file from the local filesystem directly instead.

- e343eab: Internal restructure: split `packages/agent/src/agent.ts` (688 lines, one
  class with ~30 methods) into `packages/agent/src/agent/` — `validation.ts`
  (spawn-depth/max-agents helpers, moved verbatim), `internal.ts` (a
  package-private `AgentInternal` facade), `factory.ts` (the `load`/`resume`/
  `attach`/`spawn` bodies, which own nearly all of the real complexity —
  snapshot restore, env resolution, spawn-depth/max-agents enforcement),
  `session-control.ts`, `model.ts`, `introspection.ts`, `lifecycle.ts` (the
  ~20 thin `_adapter` delegator methods, grouped by concern), and a thin
  `agent.ts` composing them.

  No public API change — `Agent`'s method signatures, return types, and
  behavior are identical. Part of the codebase restructure plan
  (plans/codebase-restructure.md, Phase 3).

- Updated dependencies [e343eab]
  - @drej/core@0.6.1
  - drej@0.10.2

## 0.5.0

### Minor Changes

- dd89d67: Add `Agent.spawn()`: fork a running agent's live sandbox — filesystem, installed packages, checked-out state — into an independent child running its own Pi bridge, instead of always starting a child from a spec's own snapshot. Exposed via `drejx spawn <name> <child-spec> [--prompt] [--spawn-depth N] [--json]`.

  - `AgentSpec` gains an optional `spawnDepth` field, translated by `Agent.load()`/`Agent.resume()` into `DREJX_SPAWN_DEPTH`. `Agent.spawn()` refuses unless this is a positive integer, and force-computes `depth - 1` into the child regardless of what the child's own spec says — a tamper-resistant counter, not something a spec author or the model can hand-propagate incorrectly.
  - The child's environment is resolved fresh from its own spec, then every name the parent's own env declares is explicitly `unset` in the exact shell command that starts the child's bridge — verified live that `sb.fork()`'s forked container otherwise carries the parent's env vars forward regardless of what's written to `/etc/drej-env`.
  - `Agent.attach()`: connects to a running sandbox without touching its Pi bridge, unlike `resume()` — needed because `drejx spawn` runs as a CLI process invoked by the very Pi bash-tool call it's attaching to; going through `resume()` there would kill the bridge running the process making the call.
  - Fixes two pre-existing gaps in `drej`'s `client.restoreSnapshot()` and `client.connect()`, found while building this: neither wired up the `fork` dependency on the `Sandbox` it returned, so `.fork()` (and now `Agent.spawn()`) would throw "fork() is not supported on this sandbox" for any agent loaded from its snapshot fast path, or attached to via `Agent.attach()`. `client.connect()` now accepts an optional `resources` param to enable this.

### Patch Changes

- Updated dependencies [dd89d67]
  - drej@0.10.1

## 0.4.0

### Minor Changes

- b7aaa2f: Add `agent.getState()`, wrapping Pi's `get_state` RPC command. Returns the current model, thinking level, streaming/compaction status, queue modes, and session identity — the only piece of Pi's RPC surface that wasn't already exposed (every other method already had an `Agent` wrapper). Needed to show live agent status (current model, thinking level, auto-compaction) without guessing from side effects of other calls.

### Patch Changes

- 5055755: `AgentSpec.cliVersion` now actually pins the installed Pi CLI version. Previously it was only used as a setup-hash cache-key input — `install()` always ran `npm install -g @earendil-works/pi-coding-agent` with no version qualifier, so setting `cliVersion` had no effect on which version got installed. `install()` now runs `npm install -g @earendil-works/pi-coding-agent@<cliVersion>` when `cliVersion` is set (accepts an exact version, a semver range, or a dist-tag like `"latest"`), and falls back to the bare package name when omitted.
- 9cc6b08: Default `serverUrl` (in `drej.config.json` / `readProjectConfig`) is now `http://127.0.0.1:8080` instead of `http://localhost:8080`. On hosts where `localhost` resolves to `::1` first but OpenSandbox only listens on IPv4, the old default caused every request — including `Agent.load()`'s sandbox creation — to fail with a socket error instead of connecting.
- Updated dependencies [13b826b]
- Updated dependencies [fa18120]
  - drej@0.10.0
  - @drej/core@0.6.0

## 0.3.2

### Patch Changes

- a4856f1: Fix every published package that depends on a sibling workspace package shipping a literal `"workspace:*"` version string instead of a real semver range.

  `changeset publish` always shells out to plain `npm publish`, which has no concept of the `workspace:` protocol — unlike `bun publish`/`pnpm publish`, which resolve it automatically. Every currently published version of `drej`, `@drej/agent`, `@drej/workflow`, and `drejx` has `"workspace:*"` in its `dependencies`, which `npm install` cannot resolve at all (`EUNSUPPORTEDPROTOCOL`). Installing any of these packages from npm fails outright.

  Added `scripts/resolve-workspace-protocol.ts`, run in CI immediately before `npm publish`, which rewrites every `workspace:*`/`workspace:^`/`workspace:~` dependency range to the corresponding package's already-resolved version before the tarball is packed.

- Updated dependencies [a4856f1]
  - @drej/core@0.5.3
  - drej@0.9.3
  - @drej/sqlite@0.3.4

## 0.3.1

### Patch Changes

- a91651c: Fix npm publish failures and a broken `drejx` CLI build:

  - Add the missing `repository` field to every published package's `package.json`. Without it, npm rejects publishes with `provenance: true` enabled (added previously) — every package failed to publish with a 422 "Error verifying sigstore provenance bundle" (see the last "Version Packages" release run).
  - Add `packages/cli` to the root `build` script. It was never built by CI before publish, so every previously-published `drejx` version (up to and including 0.2.1 on npm) shipped with no `dist/` folder at all — the CLI has never actually worked when installed from npm.
  - Remove a duplicate shebang in `packages/cli/tsdown.config.ts`'s `banner` config (the source file already has its own `#!/usr/bin/env bun`), which produced a syntactically broken `dist/index.mjs` whenever the package _was_ built manually.
  - Add `packages/agent` and `packages/cli` to the root `typecheck` script — both were previously only checked ad hoc.

- Updated dependencies [a91651c]
  - @drej/core@0.5.2
  - drej@0.9.2
  - @drej/sqlite@0.3.3

## 0.3.0

### Minor Changes

- fdc25db: Complete Pi RPC coverage: forward all Pi stdout events and implement all remaining RPC commands.

  **New `AgentEvent` variants (11):** `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update` (with `delta` field renaming Pi's `assistantMessageEvent`), `message_end`, `queue_update`, `compaction_start`, `compaction_end`, `extension_error`.

  **New `Agent` methods (9):**

  - `abortBash()` — stop a running bash command without cancelling the whole prompt
  - `getSessionStats()` — token usage, cost, and message counts (`SessionStats`)
  - `getLastAssistantText()` — retrieve the last Pi response without iterating a stream
  - `getForkMessages()` — list fork entry points in the current session
  - `getCommands()` — introspect Pi slash commands, skills, and prompt templates (`PiSlashCommand[]`)
  - `setSessionName(name)` — set a display name for the current session
  - `setSteeringMode(mode)` — control how queued steers are applied (`"all" | "one-at-a-time"`)
  - `setFollowUpMode(mode)` — control how queued follow-ups are sent (`"all" | "one-at-a-time"`)
  - `exportHtml(outputPath?)` — export an HTML transcript to the sandbox filesystem

  **New exported types:** `SessionStats`, `PiSlashCommand`.

### Patch Changes

- 34cfa8b: Add the missing `license` field (Apache-2.0) to every published package's `package.json`, matching the repo's root `LICENSE` file.
- cf9af70: Fix extension_ui_request bug and add auto-retry API

  - **Bug fix**: `extension_ui_request` events from Pi extensions were silently dropped by the bridge. Dialog requests (select/confirm/input/editor) now receive an immediate `cancelled` response so Pi never stalls indefinitely. All extension UI events are forwarded through the stream as a new `extension_ui` AgentEvent.

  - **New**: `agent.setAutoRetry(enabled)` — enable or disable Pi's built-in exponential-backoff retry on transient errors (429, 5xx). On by default (3 attempts, 2 s / 4 s / 8 s).

  - **New**: `agent.abortRetry()` — abort an in-progress retry immediately.

  - **New events**: `auto_retry_start` and `auto_retry_end` are now forwarded through the AgentStream with full context (attempt, maxAttempts, delayMs, errorMessage, finalError).

- bca2a6b: Fix JSDoc comments that no longer matched the code they document (stale `DrejClient` references, incorrect claims about `DrejError`, `watchMetrics()`, `resume()`, `exec()` ledger logging, `CommandError`, `computeSetupHash`, `bash()` streaming, and the `when()` predicate context), and flag two fields (`AgentSpec.cliVersion`, `.metadata`, `.registryDependencies`) and one known concurrency limitation (`FlushContext` under `forEach({ concurrency > 1 })`) that are currently no-ops/buggy rather than doing what they were documented to do. No behavior changes — doc-only.
- 7fb9d35: Reword `AgentSpec.cliVersion`/`.metadata`/`.registryDependencies` JSDoc to state their current behavior as plain fact instead of flag-style "NOT YET IMPLEMENTED" annotations. No behavior change.
- 3f362d1: Enable npm provenance for published packages.
- Updated dependencies [34cfa8b]
- Updated dependencies [bca2a6b]
- Updated dependencies [3f362d1]
  - @drej/core@0.5.1
  - drej@0.9.1
  - @drej/sqlite@0.3.2

## 0.2.0

### Minor Changes

- f803858: Agent snapshotting: `Agent.load()` checkpoints the sandbox after Pi install and restores from the snapshot on subsequent loads, reducing startup from ~90s to ~8s. `checkpoint()` now returns the snapshot ID. New `Drej.restoreSnapshot(snapshotId, name, resources)` creates a sandbox from a snapshot without exec replay. `Agent.load()` accepts `{ rebuild: true }` to force reinstall.
- 3f55f48: Surface Pi tool call events through `AgentStream`

  `Agent.prompt()` and `Agent.bash()` now return `AgentStream` (an
  `AsyncIterable<AgentEvent>`) instead of `AsyncIterable<string>`. Each
  `AgentEvent` is a discriminated union:

  - `{ type: "text"; text: string }` — Pi's response text (as before)
  - `{ type: "tool_start"; toolCallId; toolName; args }` — Pi began a tool call
  - `{ type: "tool_update"; toolCallId; toolName; partialResult }` — streaming tool progress
  - `{ type: "tool_end"; toolCallId; toolName; result; isError }` — tool finished

  Use the new `textOnly(stream)` helper to filter to text only (drop-in for old
  `PromptStream` loops). `PromptStream` is kept as a deprecated type alias.

- e9a9110: Add `setup` steps to `AgentSpec`: declarative bash commands that run after Pi CLI install and are baked into the snapshot. Any change to the steps automatically invalidates the snapshot cache.
- b773030: Pi adapter: SSE streaming on prompt/bash responses, bash via ack-based pendingCmds (output extracted from RPC response data field), streamingBehavior support for mid-flight injection, steer acknowledgment, and 13 additional RPC commands (setModel, cycleModel, setThinkingLevel, cycleThinkingLevel, setAutoCompaction, compact, getMessages, getAvailableModels, clone, fork, followUp, abort, getLogs).
- c81c77d: Sandbox API extensions: `pause()` / `resume()`, `createSession()` / `BashSession` persistent shell sessions, `diagnosticLogs()` / `diagnosticEvents()`, `watchMetrics()` streaming, and `Drej.connect()` for attaching to an already-running container. Agent: `Agent.resume(sandboxId)` to reconnect a new host process to a live agent sandbox (restarts the bridge with `--continue`).

### Patch Changes

- a0c1eee: Add README to each published package so npm shows documentation on the package page.
- Updated dependencies [a0c1eee]
- Updated dependencies [f803858]
- Updated dependencies [c81c77d]
  - drej@0.9.0
  - @drej/sqlite@0.3.1
  - @drej/core@0.5.0

## 0.1.1

### Patch Changes

- 2c2eb16: Add JSDoc to all public exports: `Agent` class, `AgentSpec` interface fields, `PromptStream` type, `DrejAgentConfig`, and `readProjectConfig`.
- Updated dependencies [10417e3]
- Updated dependencies [5a63143]
- Updated dependencies [416bc72]
- Updated dependencies [f83ccf2]
- Updated dependencies [0398728]
- Updated dependencies [4f79c8e]
- Updated dependencies [2ed4de7]
- Updated dependencies [02bcb01]
- Updated dependencies [2bbd8dc]
- Updated dependencies [599d707]
  - drej@0.8.0
  - @drej/core@0.4.0
  - @drej/sqlite@0.3.0
