---
"drej": minor
---

Add fluent workflow builder API to TypeScript SDK.

`workflow(id)` returns a `WorkflowBuilder` with chainable `.sandbox()` and `.parallel()` methods. Inside a sandbox scope, `SandboxStepBuilder` provides `.exec()`, `.writeFile()`, `.retry()`, `.forEach()`, `.when()`, and `.parallel()`. The `forEach` callback receives `(s, item)` where `item` serialises to `{{name}}` in template literals, enabling natural JS interpolation. Top-level `.parallel()` supports multiple concurrent sandbox sessions via `WorkflowParallelBuilder`. `DrejClient.run(w)` accepts a built workflow directly. The `sandbox()` helper defaults the entrypoint to `["tail", "-f", "/dev/null"]`.

Adds a server-side `sequence` step type that runs child steps sequentially, used internally by the builder to represent multi-step parallel branches.
