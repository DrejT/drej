---
"@drej/core": minor
"drej": minor
---

refactor: split large source files into focused modules

`@drej/core`: `steps.ts` (428 lines) split into `steps/` directory — `types.ts`, `utils.ts`, `sandbox.ts`, `exec.ts`, `file.ts`, `snapshot.ts`, `control-flow.ts`, `index.ts`. `buildStep` becomes a thin router that delegates to per-step-type builders; no circular dependencies.

`drej` SDK: `client.ts` split into `types.ts` (DrejError, WorkflowRun, option interfaces) and `stream.ts` (makeStream standalone function). `workflow.ts` split into `builder/` directory — `types.ts`, `sandbox-step.ts`, `workflow.ts`, `index.ts`. No public API changes.
