---
"@drej/agent": minor
---

Add `agent.getState()`, wrapping Pi's `get_state` RPC command. Returns the current model, thinking level, streaming/compaction status, queue modes, and session identity — the only piece of Pi's RPC surface that wasn't already exposed (every other method already had an `Agent` wrapper). Needed to show live agent status (current model, thinking level, auto-compaction) without guessing from side effects of other calls.
