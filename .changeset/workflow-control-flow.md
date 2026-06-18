---
"drej": minor
---

Add retry, conditional, loop, and parallel step types to the workflow engine.

- `retry` — retries a child step up to N times with fixed or exponential backoff
- `conditional` — branches on a structured predicate (`eq`, `neq`, `gt`, `lt`, `exists`, `and`, `or`) evaluated against workflow state
- `loop` — iterates over a static `items` array or a dot-path `over` pointing to an array in state; supports `concurrently` flag for parallel iterations
- `parallel` — fans out multiple steps with `Promise.all`; emits events with a `branch` index for demuxing
- `{{key}}` interpolation in `exec_command` so loop items and other state values can be referenced in command strings
- `branch` field added to `WorkflowEvent` to identify parallel branch origin
- `Predicate` type exported from the SDK for use with `conditional` steps
