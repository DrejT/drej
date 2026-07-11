---
"@drej/agent": patch
---

Internal restructure: extract the ~540-line Node.js bridge script out of
`packages/agent/src/adapters/pi.ts`'s `BRIDGE_SCRIPT` template literal into a
real file, `packages/agent/src/adapters/pi-bridge.js` — it now gets actual
lint/format coverage instead of living as an opaque string with zero tooling
support. Read at runtime relative to its own module location and copied
into `dist/` alongside `index.mjs` by tsdown's `copy` config, so resolution
works identically in dev and the published package. (Bun's native text
import attribute was tried first but isn't understood by rolldown, the
bundler this package's publish build actually uses.)

No behavior change — the bridge script's content is byte-identical, verified
by evaluating the original template literal and diffing against the
extracted file before making the switch. Part of the codebase restructure
plan (plans/codebase-restructure.md, Phase 4).
