---
"drej": minor
"@drejt/opensandbox": patch
"@drejt/core": patch
---

Add `execCode()` to the workflow builder and expose exit code in workflow state.

`SandboxStepBuilder.execCode()` lets you run code directly (Python, Node.js, etc.)
via execd's code interpreter — with optional stateful context to share variables
across calls. Previously only shell commands (`exec()`) were available in the builder.

`exec()` now captures the command exit code from the SSE stream and sets
`exitCode` on workflow state after each step. This makes `when({ field: "exitCode" })`
predicates actually useful for branching on command success or failure.

`CodeContext` is now exported from the `drej` package for consumers who want to
type context options explicitly.
