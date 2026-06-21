# @drej/core

## 0.2.0

### Minor Changes

- 4c0ad93: Add `capture` option to `exec()` for storing stdout in workflow state

  Pass `{ capture: "key" }` to store a command's stdout under that key in
  workflow state. The value is immediately available for interpolation in
  subsequent steps via `{{key}}`, or accessible on `WorkflowState` after
  the run. Trailing newlines are trimmed.

  ```ts
  workflow("deploy").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
    s
      .exec("git rev-parse HEAD", { capture: "sha" })
      .exec("echo deploying commit {{sha}}")
  );
  ```

- a971b7b: Add `s.readFile(path, { as })` step to read sandbox files into workflow state

  File contents are stored under the given key and immediately available for
  interpolation in subsequent steps via `{{key}}`, or accessible on the final
  workflow state after the run. Supports `utf8` (default) and `base64` encoding.

  ```ts
  workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
    s
      .exec('node -e "process.version" > /tmp/version.txt')
      .readFile("/tmp/version.txt", { as: "version" })
      .exec("echo Node version: {{version}}")
  );
  ```

- ce173be: Make sandbox lifecycle explicit — no more implicit deletion

  Previously `workflow().sandbox(opts, fn)` automatically deleted the sandbox
  at the end of the workflow and on rollback. Sandbox lifecycle is now the
  caller's responsibility.

  **What changed:**

  - `sandbox()` no longer appends a `delete_sandbox` step or rolls back on failure
  - `sandbox()` now accepts an existing `Sandbox` object in place of `SandboxOpts`,
    letting you pass a sandbox you created and manage yourself
  - Call `client.deleteSandbox(id)` explicitly when you are done with a sandbox

  ```ts
  // Create a fresh sandbox — stays alive after the workflow
  const run = await client.run(
    workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
      s.exec("npm ci").exec("npm test"),
    ),
  );
  for await (const ev of run) { ... }
  await client.deleteSandbox(run.sandboxId); // explicit cleanup

  // Or manage the sandbox yourself
  const sb = await client.createSandbox({ image: { uri: "node:20-slim" } });
  await client.run(workflow("build").sandbox(sb, (s) => s.exec("npm test")));
  await client.run(workflow("lint").sandbox(sb, (s) => s.exec("npm run lint")));
  await client.deleteSandbox(sb.id);
  ```

- 86c2dde: Add `s.snapshot()` as a first-class workflow step

  Previously, capturing a sandbox snapshot required passing `snapshotConfig: { afterSteps: [N] }` to `client.run()` — which meant counting step indices upfront and re-counting whenever steps were reordered.

  `s.snapshot()` declares the checkpoint inline, where it belongs:

  ```ts
  workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
    s
      .exec("npm ci")
      .snapshot() // checkpoint: deps installed
      .exec("npm test")
  );
  ```

  The snapshot ID is persisted to the ledger and stored in workflow state as `snapshotId`. `client.replayFromSnapshot()` works the same way regardless of which method was used to take the snapshot.

  `snapshotConfig` on `client.run()` remains supported — it is useful when you need to snapshot a workflow you didn't write, or snapshot on a cadence (`everyNSteps`) rather than at a fixed point.

- 82094ae: Add typed workflow errors: `SandboxError`, `ExecConnectionError`, `CommandError`.

  Infra failures (sandbox boot failure, execd connection timeout) now throw typed errors instead of generic `Error`. Add `strict` option to `exec()` — when enabled, a non-zero exit code throws `CommandError` with the exit code attached. Errors propagate through the `WorkflowRun` async iterator so callers can catch them with a standard `try/catch` around the `for await` loop. All failures continue to be recorded in the ledger via `LedgerEvent.StepFailed`.

### Patch Changes

- b04f8eb: Add `execCode()` to the workflow builder and expose exit code in workflow state.

  `SandboxStepBuilder.execCode()` lets you run code directly (Python, Node.js, etc.)
  via execd's code interpreter — with optional stateful context to share variables
  across calls. Previously only shell commands (`exec()`) were available in the builder.

  `exec()` now captures the command exit code from the SSE stream and sets
  `exitCode` on workflow state after each step. This makes `when({ field: "exitCode" })`
  predicates actually useful for branching on command success or failure.

  `CodeContext` is now exported from the `drej` package for consumers who want to
  type context options explicitly.

- Updated dependencies [b04f8eb]
  - @drej/opensandbox@0.1.2

## 0.1.1

### Patch Changes

- 0ea4c33: Rename npm scope from `@drej/*` to `@drej/*` and add TSDoc to all public API surfaces.

  - All workspace packages now published under `@drej/*` (e.g. `@drej/sqlite`, `@drej/postgres`)
  - `DrejClient`, `WorkflowBuilder`, `SandboxStepBuilder`, `IStorageAdapter`, `LedgerEvent`, `SandboxOpts` and all their members now have hover documentation visible in VS Code

- Updated dependencies [0ea4c33]
  - @drej/opensandbox@0.1.1

## 0.1.0

### Minor Changes

- 82e77fd: Introduce pluggable storage adapter system.

  - `ILedger` renamed to `IStorageAdapter` with optional `connect()` and `close()` lifecycle methods
  - `DrejClientOptions.adapter` accepts any `IStorageAdapter` implementation; `DrejClient` exposes matching `connect()` and `close()` methods
  - New `@drej/postgres` package: `PostgresAdapter` backed by a user-supplied Postgres connection string; owns its schema and runs migrations on `connect()`

- 5d77498: Bundle SDK, publish workspace packages publicly, and make adapter required.

  - `@drej/core` and `@drej/opensandbox` are now published public packages (previously private workspace-only)
  - `drej` SDK ships a pre-built `dist/` with a bundled ESM JS file and TypeScript declarations; `"main"` now points to `./dist/index.js`
  - `WorkflowDeps.ledger` field renamed to `WorkflowDeps.adapter`
  - `DrejClientOptions.adapter` is now **required** — callers must supply a storage adapter (`@drej/sqlite`, `@drej/postgres`, or a custom `IStorageAdapter`)
  - `MemoryAdapter`, `NdjsonAdapter`, and the `ledgerDir` shorthand have been removed; drej has no built-in storage opinion
  - Root `build` script added: generates declarations for workspace packages then runs tsup for the SDK

### Patch Changes

- Updated dependencies [5d77498]
  - @drej/opensandbox@0.1.0
