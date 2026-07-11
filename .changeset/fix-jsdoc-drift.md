---
"@drej/core": patch
"@drej/agent": patch
"drej": patch
---

Docs only, no behavior change. Fixed JSDoc comments that had drifted from the
code they document — mostly leftovers from the `sandbox.ts`/`agent.ts` module
split:

- `SandboxCore.exec()`'s interactive-mode doc was missing `close()` from the
  `InteractiveExecHandle` method list.
- `fork()` (both the `Sandbox` method and the underlying `lifecycle.ts`
  function) claimed to be equivalent to `checkpoint()` + `Drej.resume()`; it's
  actually equivalent to `checkpoint()` + `Drej.restoreSnapshot()` — no exec
  history is replayed, unlike `resume()`.
- `SandboxInternal`'s doc referenced a nonexistent `_replayCache` field (the
  real field is `replayCache`, not private).
- `SandboxError`'s doc said it's only thrown for create/boot/`Running`
  failures; it's also thrown for the paused-sandbox guard, unsupported
  `fork()`, and snapshot failures.
- `StepTimeoutError`'s doc referenced a nonexistent `RunOptions.stepTimeoutMs`
  and a rollback behavior that was never implemented — this class is
  currently unused; the doc now says so instead of describing a mechanism
  that doesn't exist.
- `SandboxOptions.name`'s doc referenced a "shortRunId" that isn't a real
  concept in this codebase; the actual default uses the first 8 characters of
  `sandboxId`.
- `Agent`'s class-level `@example` called `Agent.load()` without the required
  `opts.adapter` argument.
- `Agent.attach()`'s doc said its main caller is `drejx spawn`; it's actually
  `drejx fork` (`drejx spawn` calls `Agent.load()`, not `attach()`).
- `Agent.spawn()`'s doc referenced `fork()`/`clone()` as being "above" it in
  the file; they're below.

Docs site (`apps/docs/`, not a published package) updated to match, plus a
broader sweep found unrelated pre-existing drift fixed in the same pass:

- `core/api-reference/errors.mdx`'s `SandboxError` hierarchy summary was
  narrower than its own detailed section below it — broadened to match.
- `core/patterns/fork.mdx` now calls out that `fork()` matches
  `restoreSnapshot()`, not `resume()`.
- Added `restoreSnapshot()` and `connect()` sections to
  `core/api-reference/drej-client.mdx` — both are public `Drej` client
  methods that had no documentation anywhere on the site. `resume()`'s
  signature was also missing its `opts?: { tag?: string }` param.
- `core/concepts/sandboxes.mdx` showed `SandboxOptions.resources` as fully
  optional (`{ cpu?, memory?, gpu? }`); `cpu`/`memory` are actually required.
- `core/building/exec.mdx`'s `execCode()` example omitted the `entrypoint`
  override that `opensandbox/code-interpreter` requires to actually start,
  and its "stateful execution" example hand-rolled a context object instead
  of calling `createCodeContext()` (contradicting the code's own docstring).
- `core/building/file-ops.mdx` claimed all file operations are queueable in
  `SandboxBuilder`; only `writeFile`/`readFile`/`deleteFile`/`moveFile` are.
- `core/api-reference/index.mdx` and `core/concepts/storage-adapters.mdx`
  said "`Drej` has no `connect()`" — false, conflating the storage adapter's
  optional `connect()`/`close()` with the client's own real `connect()`
  method. Reworded to distinguish the two.
- `core/adapters/custom.mdx` and `core/adapters/postgres.mdx` overstated
  adapter `close()` as running "when the process exits" — it only runs on
  `beforeExit`, which long-running servers never reach.
- `agent/api-reference/agent.mdx`: `ThinkingLevel` documented as
  `"low" | "medium" | "high"`, missing `"none"`; default `serverUrl` shown as
  `http://localhost:8080` instead of the actual `http://127.0.0.1:8080`
  (the source has an explicit comment warning against `"localhost"` due to
  IPv6/IPv4 resolution issues on some hosts).
- `workflow/building/parallel-sequence.mdx`'s `SequenceStep` interface
  omitted `env`/`timeout` fields, showed `resources` as optional when it's
  required, and claimed `prev` is `{ stdout: "", vars: {} }` on the first
  step when it's actually `undefined`.
- `workflow/building/control-flow.mdx` reused the name `FlushContext` for a
  3-field shape that doesn't match the real (4-field) exported
  `FlushContext` interface — renamed to avoid the collision.
- `drejx/commands/add.mdx` claimed `add` throws without a prior `drejx init`;
  it actually falls back to an auto-created global config.
- `drejx/registry/schema.mdx` said spec validation only checks `name`/`cli`;
  it also validates `spawnDepth`/`maxAgents`.
- `drejx/commands/index.mdx` claimed every agent-lifecycle command addresses
  sessions by sandbox ID; `fork`/`logs` actually address by name.
- Fixed a broken same-page anchor link in `drejx/commands/fork.mdx`, and two
  more `localhost:8080` → `127.0.0.1:8080` corrections in
  `drejx/commands/init.mdx` and `drejx/getting-started/quickstart.mdx`.
