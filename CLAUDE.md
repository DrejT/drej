# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> For any questions about the OpenSandbox API, behavior, or internals, use the DeepWiki MCP tool (`mcp__deepwiki__ask_question`) against `https://deepwiki.com/opensandbox-group/OpenSandbox/`.

## Agent Skills

Reusable skill references live in `.agents/skills/<name>/SKILL.md`. Always check this folder before reaching for external docs — skills contain curated quick references and gotchas specific to tools used in this repo.

Available skills:

- **`.agents/skills/bun/`** — Bun runtime, package manager, test runner, and bundler. Covers `bun run`, `bun install`, `bun test`, `bun build`, workspace flags, common gotchas (flag placement, lifecycle scripts, lockfile format), and key APIs (`Bun.file()`, `Bun.serve()`, `Bun.write()`)

Example: before writing a `bun build` command or debugging a workspace install issue, read `.agents/skills/bun/SKILL.md` for the correct flags and known pitfalls.

## What this is

`drej` is a workflow orchestration framework built on top of [OpenSandbox](https://opensandbox.ai). It lets you define multi-step workflows that run inside isolated sandbox containers. Workflows execute in-process — there is no separate drej server. The `Drej` client talks directly to your OpenSandbox instance and streams events via an async generator.

## Commands

```bash
# Run the hello-world example
bun run examples/hello-world.ts

# Run an example's integration test (requires uvx opensandbox-server running)
bun examples/hello-world/tests/integration.ts
bun examples/file-ops/tests/integration.ts

# Build the SDK for publishing (generates dist/ across all packages)
bun run build

# Typecheck all packages
bun run typecheck

# Typecheck packages individually
bunx tsc --noEmit --strict --project packages/opensandbox/tsconfig.json
bunx tsc --noEmit --strict --project packages/core/tsconfig.json
bunx tsc --noEmit --strict --project packages/sdks/typescript/tsconfig.json
bunx tsc --noEmit --strict --project packages/adapters/postgres/tsconfig.json

# Changesets (required on every PR touching publishable packages)
bunx changeset        # add a changeset
bunx changeset status # verify one exists

# IMPORTANT: after committing code changes, always add and commit a changeset too.
# The CI changeset check (bunx changeset status --since origin/main) reads from
# git history — an uncommitted changeset file will NOT satisfy it.
```

## Testing

### Two test layers

**Unit tests** live in `packages/*/test/*.test.ts` and run via `bun test`. They test internal builder logic, control-flow, and adapter behaviour in isolation — no sandbox required.

**Integration tests** live in `examples/<name>/tests/integration.ts` and run with `bun examples/<name>/tests/integration.ts`. They hit a real OpenSandbox sandbox and assert on live stdout and captured state. Every example must have one.

### Integration test conventions

- **Run with**: `bun tests/integration.ts` from within the example directory, or `bun examples/<name>/tests/integration.ts` from the repo root.
- **Requires**: `uvx opensandbox-server` running locally (see Local OpenSandbox setup).
- **Client setup**: always use `SQLiteAdapter("./ledger.db")`, read `OPEN_SANDBOX_URL` and `OPEN_SANDBOX_API_KEY` from env with localhost defaults.
- **Assertion helper**: define a local `assert(label, ok, got?)` function — prints `FAIL: <label> — got: <value>` and sets `failed = true`. Never use a test framework; exit with `process.exit(1)` if any assertion failed.
- **Event loop**: `for await (const ev of run)` — collect `exec_event` stdout, capture `step_complete` payload as `finalState`, log other events. Never filter events with a test framework matcher.
- **Captured refs**: declare `let fooKey: string` outside the builder, assign inside (`fooKey = s.readFile(...).key`), then read from `finalState[fooKey!]` after the loop.
- **Multiple patterns**: group test scenarios with `// ── Pattern A: ... ───` section comments; share a single `failed` flag and `assert` helper across all of them.
- **Cleanup**: call `await client.close()` at the end (after the exit check for single-scenario tests; inside a `finally` for multi-scenario ones where the run might throw).
- **Error tests**: wrap the `for await` in `try/catch`; rethrow if not the expected error class.

### What to assert

Assert on observable behaviour, not internal structure:
- stdout/stderr content from `exec_event` payloads
- `run.status === "completed"` (or `"failed"`)
- captured values from `finalState[key]` (readFile contents, searchFiles arrays, getFileInfo shape, etc.)
- error class and `.exitCode` for `CommandError` cases

## Architecture

```
packages/core/                    — Workflow engine (no runtime deps outside opensandbox)
  src/steps/
    types.ts                      — StepDef union, StepType enum, Encoding enum, Backoff enum, Predicate, SnapshotConfig
    utils.ts                      — getPath, interpolate, evaluate, runWithConcurrency (internal)
    sandbox.ts                    — create_sandbox / delete_sandbox builders; resolveExecClient()
    exec.ts                       — exec_command / exec_code builders
    file.ts                       — write_file / read_file builders
    snapshot.ts                   — snapshot builder; shouldSnapshot(), waitForSnapshot()
    control-flow.ts               — retry / conditional / loop / parallel / sequence builders
    index.ts                      — buildStep() router + barrel exports
  src/ledger.ts                   — IStorageAdapter, LedgerEvent, RunStatus, RunDetails, ListRunsOptions
  src/workflow.ts                 — Workflow class (run, rollback, resumeFromLedger), WorkflowHooks, WorkflowDeps
  src/errors.ts                   — WorkflowError, SandboxError, ExecConnectionError, CommandError
  src/validate.ts                 — validateWorkflow() (checks execCode requires code-interpreter image)
  src/logger.ts                   — ILogger, ConsoleLogger, noopLogger

packages/opensandbox/             — OpenSandbox HTTP clients
  src/control.ts                  — ControlClient (sandbox lifecycle via REST)
  src/exec.ts                     — ExecClient (code/command execution via SSE)
  src/types.ts                    — Full OpenSandbox API type system

packages/sdks/typescript/         — Public TypeScript SDK (published to npm as "drej")
  src/types.ts                    — DrejError, WorkflowRun, DrejClientOptions, RunOptions, WorkflowEvent
  src/stream.ts                   — makeStream() — async generator pipeline (tee adapter + event queue)
  src/client.ts                   — DrejClient: run, resumeRun, replayFromSnapshot, sandbox/snapshot/run mgmt
  src/builder/
    types.ts                      — SandboxOpts, LoopItem, wrapSteps(), createLoopVar()
    sandbox-step.ts               — SandboxStepBuilder, SandboxParallelBuilder
    workflow.ts                   — WorkflowBuilder, WorkflowParallelBuilder, workflow()
    index.ts                      — builder barrel exports

packages/adapters/postgres/       — Postgres storage adapter (published as "@drej/postgres")
  src/adapter.ts                  — PostgresAdapter implementing IStorageAdapter
  src/migrations.ts               — Idempotent CREATE TABLE IF NOT EXISTS schema

packages/adapters/sqlite/         — SQLite storage adapter (published as "@drej/sqlite")
  src/adapter.ts                  — SQLiteAdapter via bun:sqlite (zero extra deps, WAL mode enabled)
  src/migrations.ts               — Idempotent CREATE TABLE IF NOT EXISTS schema

packages/adapters/otel/           — OpenTelemetry hooks adapter (published as "@drej/otel")
  src/index.ts                    — otelHooks(tracer, opts?) → WorkflowHooks
```

### Key design points

**In-process execution**: `DrejClient` runs workflows directly in the calling process. No HTTP server, no separate drej daemon. Instantiate `DrejClient` with your OpenSandbox URL and call `client.run(workflow(...))`.

**Fluent builder API**: Workflows are constructed via `workflow(name).sandbox(opts, s => s.exec(...).writeFile(...))`. The builder compiles down to a `StepDef[]` which the core engine executes. Step types are defined by the `StepType` enum (`StepType.ExecCommand`, `StepType.Loop`, etc.). File encoding uses the `Encoding` enum (`Encoding.UTF8`, `Encoding.Base64`). Retry backoff uses the `Backoff` enum (`Backoff.Fixed`, `Backoff.Exponential`).

**Async event stream**: `client.run()` returns a `WorkflowRun` which is an `AsyncIterable<WorkflowEvent>`. Callers `for await` over events in real-time as steps execute. Every event is also persisted to the ledger simultaneously. The streaming engine lives in `stream.ts` as a standalone `makeStream()` function. `WorkflowRun.status` tracks `Running → Completed | Failed | Cancelled` as the iterator is consumed.

**Storage adapter**: `DrejClientOptions.adapter` accepts any `IStorageAdapter` implementation — pass `new SQLiteAdapter("./drej.db")` for local dev or `new PostgresAdapter(connectionString)` for production. Call `await client.connect()` before first use; `await client.close()` on shutdown.

**Run management**: `IStorageAdapter` and `DrejClient` expose `listRunDetails(workflowName, opts?)`, `listAllRunDetails(opts?)`, `getRunDetails(workflowName, runId)`, and `deleteRun(workflowName, runId)`. Run details are derived from ledger events via a single SQL aggregation query — no full event scan. `RunStatus` (`Running | Completed | Failed | Cancelled`) and `RunDetails` are exported from both `@drej/core` and `drej`.

**Concurrency limits**: `DrejClientOptions.maxConcurrency` caps simultaneous workflow runs. `run()` awaits a semaphore slot before starting; the slot is released via a `finally`-wrapped generator when the `WorkflowRun` is exhausted or cancelled. Within a workflow, `parallel()` and `forEach()` accept `{ concurrency: N }` to throttle branch/iteration parallelism using a worker-pool pattern.

**Hooks**: `WorkflowHooks` (in `packages/core/src/workflow.ts`) provides lifecycle callbacks: `onWorkflowStart`, `onStepStart`, `onStepComplete`, `onStepFailed`, `onStepRolledBack`, `onWorkflowComplete`, `onWorkflowFailed`. Pass via `RunOptions.hooks`. Use `otelHooks(tracer)` from `@drej/otel` for OpenTelemetry tracing.

**Saga rollback**: If any step throws, `Workflow.rollback()` runs completed steps in reverse order using their optional `rollback()` method.

**Resumption**: `Workflow.resumeFromLedger()` reads the last `checkpoint` entry from the ledger to reconstruct completed-step state and restart from the next step. Use `client.resumeRun(name, runId, workflow)` to resume an interrupted run.

**execd readiness**: OpenSandbox reports a sandbox as "Running" before the execd process inside is ready to accept connections. `resolveExecClient()` calls `getEndpoint()` exactly once (each call returns a different ephemeral proxy port) then polls `listContexts()` until execd responds.

**Sandbox entrypoint**: Use `["tail", "-f", "/dev/null"]` as the sandbox entrypoint — `/bin/bash` exits immediately without a TTY, killing the container. The builder sets this automatically.

**`buildStep` is a router, not a monolith**: Each step type has its own builder function in `steps/`. The `buildStep()` factory in `steps/index.ts` delegates to them. Control-flow step builders (`retry`, `conditional`, `loop`, `parallel`, `sequence`) receive `buildStep` as a `BuildStepFn` parameter to avoid a circular import on `steps/index.ts`.

## Environment variables

`DrejClient` is configured via constructor options, not environment variables. The consuming application is responsible for reading env vars and passing them in:

| Option | Description |
|---|---|
| `baseUrl` | OpenSandbox server URL (e.g. `http://localhost:8080`) |
| `apiKey` | OpenSandbox API key (empty string for local dev) |
| `adapter` | `IStorageAdapter` implementation (SQLiteAdapter or PostgresAdapter) |
| `maxConcurrency` | Max simultaneous workflow runs (default: unlimited) |

## Local OpenSandbox setup

Run `uvx opensandbox-server` with `~/.sandbox.toml`:

```toml
[server]
host = "127.0.0.1"
port = 8080

[runtime]
type = "docker"
execd_image = "opensandbox/execd:v1.0.19"

[docker]
network_mode = "bridge"

[ingress]
mode = "direct"

[egress]
mode = "dns"
```

## SDK focus

We are currently focused exclusively on making the **TypeScript SDK** (`packages/sdks/typescript`) full-featured and production-ready. Python SDK is maintained but not the priority. Do not add new features to the Python SDK unless explicitly asked.

## Releases

The TypeScript SDK (`packages/sdks/typescript`) is published to npm via changesets. Every PR that changes publishable packages needs a changeset (`bunx changeset`). CI enforces this. Releases are cut automatically via `changesets/action` on merge to `main`.

> **Changeset must be committed** before CI will pass — `bunx changeset status --since origin/main` reads from git history, not disk.
