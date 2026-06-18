# drej

## 0.3.0

### Minor Changes

- 6256955: Add retry, conditional, loop, and parallel step types to the workflow engine.

  - `retry` — retries a child step up to N times with fixed or exponential backoff
  - `conditional` — branches on a structured predicate (`eq`, `neq`, `gt`, `lt`, `exists`, `and`, `or`) evaluated against workflow state
  - `loop` — iterates over a static `items` array or a dot-path `over` pointing to an array in state; supports `concurrently` flag for parallel iterations
  - `parallel` — fans out multiple steps with `Promise.all`; emits events with a `branch` index for demuxing
  - `{{key}}` interpolation in `exec_command` so loop items and other state values can be referenced in command strings
  - `branch` field added to `WorkflowEvent` to identify parallel branch origin
  - `Predicate` type exported from the SDK for use with `conditional` steps

- 2da4112: Add workflow engine support: `runWorkflow()` now supports `create_sandbox`, `exec_code`, `exec_command`, and `delete_sandbox` step types with SSE streaming and saga rollback.
- eb72eea: Add `write_file` workflow step type and always base64-encode `exec_command` strings.

  - `write_file` step writes text or binary content to a path inside the sandbox; accepts `encoding: "utf8"` (default) or `"base64"` for binary files
  - `exec_command` now unconditionally base64-encodes the command string before sending to the container, eliminating all quoting and special-character edge cases

## 0.2.1

### Patch Changes

- 5278aa9: Add `DrejError` and `run()` to the Python SDK, matching the TypeScript SDK's interface.

## 0.2.0

### Minor Changes

- c3fe034: Add `DrejClient.run(code)` method and `SandboxRunResult` type for submitting code to the sandbox execution endpoint.

### Patch Changes

- 3316570: Add `DrejError` class with HTTP status code — errors from API calls now throw `DrejError` instead of a generic `Error`.
