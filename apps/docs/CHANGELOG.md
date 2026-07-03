# docs

## 0.1.1

### Patch Changes

- cd88d21: Bump dev-dependencies group (@types/node, eslint, eslint-config-next, oxfmt, @flue/runtime) — no code changes.
- 18cbb28: Bump next to 16.2.10 (dependency patch update, no code changes).
- 1720e23: Bump react-dom to 19.2.7 (dependency patch update, no code changes).
- fd43649: Audited every .mdx page against the source code it documents and fixed 30+ mismatches: a systemic fabricated `client.connect()`/`client.close()` API (repeated across 7 files — `Drej` has neither), a completely rewritten `docs/drejx/` section (11 files — the CLI only manages local `AgentSpec` files, it never provisions sandboxes, checkpoints, or writes `.drej/sandboxes.json`, which is dead code), incorrect error-class docs (`SandboxError` vs `DrejError`), wrong `checkpoint()` return type, an incomplete `IStorageAdapter` transcription, wrong Postgres/SQLite schemas, fabricated `SandboxStatus` values, a wrong `searchFiles()` return type, a hand-rolled `execCode()` context example that doesn't work, fabricated `execCode()` options, incorrect `AgentEvent.compaction_end` types, an incomplete `compact()` return shape, `AgentSpec.cliVersion`/`.metadata`/`.registryDependencies` documented as functional when they're no-ops, and several smaller wording fixes (retry backoff math, `when()`'s cumulative-stdout semantics, a documented known limitation in concurrent `forEach`). No behavior changes — doc-only.
