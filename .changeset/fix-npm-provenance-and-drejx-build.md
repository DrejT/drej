---
"@drej/core": patch
"@drej/opensandbox": patch
"drej": patch
"@drej/workflow": patch
"@drej/postgres": patch
"@drej/sqlite": patch
"@drej/otel": patch
"@drej/flue": patch
"@drej/agent": patch
"drejx": patch
---

Fix npm publish failures and a broken `drejx` CLI build:

- Add the missing `repository` field to every published package's `package.json`. Without it, npm rejects publishes with `provenance: true` enabled (added previously) — every package failed to publish with a 422 "Error verifying sigstore provenance bundle" (see the last "Version Packages" release run).
- Add `packages/cli` to the root `build` script. It was never built by CI before publish, so every previously-published `drejx` version (up to and including 0.2.1 on npm) shipped with no `dist/` folder at all — the CLI has never actually worked when installed from npm.
- Remove a duplicate shebang in `packages/cli/tsdown.config.ts`'s `banner` config (the source file already has its own `#!/usr/bin/env bun`), which produced a syntactically broken `dist/index.mjs` whenever the package *was* built manually.
- Add `packages/agent` and `packages/cli` to the root `typecheck` script — both were previously only checked ad hoc.
