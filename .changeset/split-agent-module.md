---
"@drej/agent": patch
---

Internal restructure: split `packages/agent/src/agent.ts` (688 lines, one
class with ~30 methods) into `packages/agent/src/agent/` — `validation.ts`
(spawn-depth/max-agents helpers, moved verbatim), `internal.ts` (a
package-private `AgentInternal` facade), `factory.ts` (the `load`/`resume`/
`attach`/`spawn` bodies, which own nearly all of the real complexity —
snapshot restore, env resolution, spawn-depth/max-agents enforcement),
`session-control.ts`, `model.ts`, `introspection.ts`, `lifecycle.ts` (the
~20 thin `_adapter` delegator methods, grouped by concern), and a thin
`agent.ts` composing them.

No public API change — `Agent`'s method signatures, return types, and
behavior are identical. Part of the codebase restructure plan
(plans/codebase-restructure.md, Phase 3).
