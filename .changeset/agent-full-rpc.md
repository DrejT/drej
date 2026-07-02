---
"@drej/agent": minor
---

Complete Pi RPC coverage: forward all Pi stdout events and implement all remaining RPC commands.

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
