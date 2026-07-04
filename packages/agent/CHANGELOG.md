# @drej/agent

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
