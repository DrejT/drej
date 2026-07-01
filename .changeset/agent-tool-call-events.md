---
"@drej/agent": minor
---

Surface Pi tool call events through `AgentStream`

`Agent.prompt()` and `Agent.bash()` now return `AgentStream` (an
`AsyncIterable<AgentEvent>`) instead of `AsyncIterable<string>`. Each
`AgentEvent` is a discriminated union:

- `{ type: "text"; text: string }` — Pi's response text (as before)
- `{ type: "tool_start"; toolCallId; toolName; args }` — Pi began a tool call
- `{ type: "tool_update"; toolCallId; toolName; partialResult }` — streaming tool progress
- `{ type: "tool_end"; toolCallId; toolName; result; isError }` — tool finished

Use the new `textOnly(stream)` helper to filter to text only (drop-in for old
`PromptStream` loops). `PromptStream` is kept as a deprecated type alias.
