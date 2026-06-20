# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> For any questions about the OpenSandbox API, behavior, or internals, use the DeepWiki MCP tool (`mcp__deepwiki__ask_question`) against `https://deepwiki.com/opensandbox-group/OpenSandbox/`.

## Agent Skills

Reusable skill references live in `.agents/skills/<name>/SKILL.md`. Always check this folder before reaching for external docs — skills contain curated quick references and gotchas specific to tools used in this repo.

Available skills:

- **`.agents/skills/bun/`** — Bun runtime, package manager, test runner, and bundler. Covers `bun run`, `bun install`, `bun test`, `bun build`, workspace flags, common gotchas (flag placement, lifecycle scripts, lockfile format), and key APIs (`Bun.file()`, `Bun.serve()`, `Bun.write()`)

Example: before writing a `bun build` command or debugging a workspace install issue, read `.agents/skills/bun/SKILL.md` for the correct flags and known pitfalls.

## What this is

`drej` is a workflow orchestration framework built on top of [OpenSandbox](https://opensandbox.ai). It lets you define multi-step workflows that run inside isolated sandbox containers. Workflows execute in-process — there is no separate drej server. The `DrejClient` talks directly to your OpenSandbox instance and streams events via an async generator.

## Commands

```bash
# Run the hello-world example
bun run examples/hello-world.ts

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

## Architecture

```
packages/core/              — Workflow engine (no runtime deps outside opensandbox)
  types.ts / steps.ts       — StepDef union and buildStep() factory
  ledger.ts                 — IStorageAdapter, MemoryAdapter, NdjsonAdapter, LedgerEvent
  workflow.ts               — Workflow class (run, rollback, resumeFromLedger), WorkflowHooks

packages/opensandbox/       — OpenSandbox HTTP clients
  control.ts                — ControlClient (sandbox lifecycle via REST)
  exec.ts                   — ExecClient (code/command execution via SSE)
  types.ts                  — Full OpenSandbox API type system

packages/sdks/typescript/   — Public TypeScript SDK (published to npm as "drej")
  client.ts                 — DrejClient: runs workflows in-process, exposes sandbox/snapshot mgmt
  workflow.ts               — WorkflowBuilder, SandboxStepBuilder (fluent builder API)

packages/adapters/postgres/ — Postgres storage adapter (published as "@drejt/postgres")
  src/adapter.ts            — PostgresAdapter implementing IStorageAdapter
  src/migrations.ts         — Idempotent CREATE TABLE IF NOT EXISTS schema

packages/adapters/sqlite/   — SQLite storage adapter (published as "@drejt/sqlite")
  src/adapter.ts            — SQLiteAdapter via bun:sqlite (zero extra deps, WAL mode enabled)
  src/migrations.ts         — Idempotent CREATE TABLE IF NOT EXISTS schema
```

### Key design points

**In-process execution**: `DrejClient` runs workflows directly in the calling process. No HTTP server, no separate drej daemon. Instantiate `DrejClient` with your OpenSandbox URL and call `client.run(workflow(...))`.

**Fluent builder API**: Workflows are constructed via `workflow(name).sandbox(opts, s => s.exec(...).writeFile(...))`. The builder compiles down to a `StepDef[]` which the core engine executes. Step types include `exec_command`, `exec_code`, `write_file`, `retry`, `conditional`, `loop`, `parallel`, and `sequence`.

**Async event stream**: `client.run()` returns a `WorkflowRun` which is an `AsyncIterable<WorkflowEvent>`. Callers `for await` over events in real-time as steps execute. Every event is also persisted to the ledger simultaneously (tee pattern inside `DrejClient._makeStream`).

**Storage adapter**: `DrejClientOptions.adapter` accepts any `IStorageAdapter` implementation — pass `new PostgresAdapter(connectionString)` for production. `ledgerDir` is shorthand for an `NdjsonAdapter`. Omit both for an in-memory `MemoryAdapter`. Call `await client.connect()` before first use when using a DB-backed adapter; `await client.close()` on shutdown. The adapter backs `resumeRun()`, `replayFromSnapshot()`, `listRuns()`, and `getRunLedger()`.

**Hooks**: `WorkflowHooks` (defined in `packages/core/workflow.ts`) provides lifecycle callbacks: `onStepStart`, `onStepComplete`, `onStepFailed`, `onStepRolledBack`, `onWorkflowComplete`, `onWorkflowFailed`. Pass via `WorkflowDeps.hooks`.

**Saga rollback**: If any step throws, `Workflow.rollback()` runs completed steps in reverse. `create_sandbox` has a rollback that calls `deleteSandbox`, preventing sandbox leaks on failure.

**Resumption**: `Workflow.resumeFromLedger()` reads the last `checkpoint` entry from the ledger to reconstruct completed-step state and restart from the next step.

**execd readiness**: OpenSandbox reports a sandbox as "Running" before the execd process inside is ready to accept connections. `resolveExecClient()` calls `getEndpoint()` exactly once (each call returns a different ephemeral proxy port) then polls `listContexts()` until execd responds.

**Sandbox entrypoint**: Use `["tail", "-f", "/dev/null"]` as the sandbox entrypoint — `/bin/bash` exits immediately without a TTY, killing the container.

## Environment variables

`DrejClient` is configured via constructor options, not environment variables. The consuming application is responsible for reading env vars and passing them in:

| Option | Description |
|---|---|
| `baseUrl` | OpenSandbox server URL (e.g. `http://localhost:8080`) |
| `apiKey` | OpenSandbox API key (empty string for local dev) |
| `adapter` | Custom `IStorageAdapter` (e.g. `new PostgresAdapter(url)`) |
| `ledgerDir` | Shorthand for `new NdjsonAdapter(dir)` — durable NDJSON on disk |

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
