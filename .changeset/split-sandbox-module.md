---
"@drej/core": patch
---

Internal restructure: split `packages/core/src/sandbox.ts` (869 lines, one
class with 29 methods) into `packages/core/src/sandbox/` — `types.ts`,
`resolve.ts`, `internal.ts` (a package-private `SandboxInternal` facade),
`core.ts` (state + the exec-stream methods most tightly coupled to it),
`files.ts`, `lifecycle.ts`, `observability.ts`, `bash-session.ts`, and a
thin `sandbox.ts` composing them via delegation.

No public API change — `Sandbox`'s method signatures, return types, and
behavior are identical. Part of the codebase restructure plan
(plans/codebase-restructure.md, Phase 2).
