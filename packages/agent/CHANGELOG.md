# @drej/agent

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
