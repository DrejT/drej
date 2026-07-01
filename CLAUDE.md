# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> For any questions about the OpenSandbox API, behavior, or internals, use the DeepWiki MCP tool (`mcp__deepwiki__ask_question`) against `https://deepwiki.com/opensandbox-group/OpenSandbox/`.
>
> For any questions about the Pi coding agent CLI, RPC protocol, session management, or available commands, use the DeepWiki MCP tool against `https://deepwiki.com/earendil-works/pi/`.

## Agent Skills

Reusable skill references live in `.agents/skills/<name>/SKILL.md`. Always check this folder before reaching for external docs — skills contain curated quick references and gotchas specific to tools used in this repo.

Available skills:

- **`.agents/skills/bun/`** — Bun runtime, package manager, test runner, and bundler. Covers `bun run`, `bun install`, `bun test`, `bun build`, workspace flags, common gotchas (flag placement, lifecycle scripts, lockfile format), and key APIs (`Bun.file()`, `Bun.serve()`, `Bun.write()`)

Example: before writing a `bun build` command or debugging a workspace install issue, read `.agents/skills/bun/SKILL.md` for the correct flags and known pitfalls.

## What this is

`drej` is a **sandbox execution substrate** built on top of [OpenSandbox](https://opensandbox.ai). It gives you live sandbox containers as first-class objects — spawn, exec, checkpoint, resume — with a durable SQL audit ledger and replay. Workflow primitives (retry, when, forEach, parallel) live in the separate `@drej/workflow` package.

## Commands

```bash
# Run an example (requires OpenSandbox server — use drejx init or uvx opensandbox-server)
bun examples/hello-world/index.ts

# Run all unit tests
bun run test

# Build the SDK for publishing (generates dist/ across all packages)
bun run build

# Typecheck all packages
bun run typecheck

# Typecheck packages individually
bunx tsc --noEmit --strict --project packages/opensandbox/tsconfig.json
bunx tsc --noEmit --strict --project packages/core/tsconfig.json
bunx tsc --noEmit --strict --project packages/sdks/typescript/tsconfig.json
bunx tsc --noEmit --strict --project packages/workflow/tsconfig.json
bunx tsc --noEmit --strict --project packages/adapters/postgres/tsconfig.json
bunx tsc --noEmit --strict --project packages/adapters/sqlite/tsconfig.json
bunx tsc --noEmit --strict --project packages/adapters/otel/tsconfig.json
bunx tsc --noEmit --strict --project packages/cli/tsconfig.json
bunx tsc --noEmit --strict --project packages/agent/tsconfig.json

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

- **Run with**: `bun examples/<name>/index.ts` from the repo root (examples are also the integration tests).
- **Requires**: OpenSandbox server running locally — either `drejx init` (Docker-based, recommended) or `uvx opensandbox-server` (manual). If using `drejx init`, pass `useServerProxy: true` to `new Drej(...)` so the SDK routes through the server instead of container-direct IPs.
- **Client setup**: `new Drej({ baseUrl: ..., adapter: new SQLiteAdapter("./ledger.db") })` — no `connect()` or `close()` needed.
- **Sandbox lifecycle**: always wrap in `try/finally { await sb.close(); }` to avoid container leaks.
- **Assertion**: `const { stdout } = await sb.exec("cmd")` — assert on the returned value. For error cases, catch `CommandError`.

### What to assert

Assert on observable behaviour, not internal structure:
- `await sb.exec("cmd")` result: `stdout`, `stderr`, `exitCode`
- `await sb.readFile("/path")` content
- error class and `.exitCode` for `CommandError` cases

## Architecture

```
packages/core/                    — Sandbox primitive (no runtime deps outside opensandbox)
  src/sandbox.ts                  — Sandbox class, resolveExecClient(), SandboxHooks, SandboxDeps
  src/exec-handle.ts              — ExecHandle (PromiseLike<ExecResult>), pipe(), stdout(), result()
  src/ledger.ts                   — IStorageAdapter, LedgerEvent, SandboxStatus, SandboxDetails, ListSandboxOptions
  src/errors.ts                   — WorkflowError, SandboxError, ExecConnectionError, CommandError
  src/logger.ts                   — ILogger, ConsoleLogger, noopLogger

packages/opensandbox/             — OpenSandbox HTTP clients
  src/control.ts                  — ControlClient (sandbox lifecycle via REST)
  src/exec.ts                     — ExecClient (code/command execution via SSE)
  src/types.ts                    — Full OpenSandbox API type system

packages/sdks/typescript/         — Public TypeScript SDK (published to npm as "drej")
  src/types.ts                    — DrejError, DrejOptions, SandboxOptions
  src/client.ts                   — Drej: sandbox(), resume(), sandboxes.*

packages/workflow/                — Lazy workflow builder (published as "@drej/workflow")
  src/sandbox-builder.ts          — SandboxBuilder (synchronous queue), flushOps()
  src/workflow-builder.ts         — WorkflowBuilder, workflow() factory
  src/index.ts                    — barrel exports

packages/adapters/postgres/       — Postgres storage adapter (published as "@drej/postgres")
  src/adapter.ts                  — PostgresAdapter implementing IStorageAdapter
  src/migrations.ts               — Idempotent CREATE TABLE IF NOT EXISTS schema

packages/adapters/sqlite/         — SQLite storage adapter (published as "@drej/sqlite")
  src/adapter.ts                  — SQLiteAdapter via bun:sqlite (zero extra deps, WAL mode enabled)
  src/migrations.ts               — Idempotent CREATE TABLE IF NOT EXISTS schema

packages/adapters/otel/           — OpenTelemetry hooks adapter (published as "@drej/otel")
  src/index.ts                    — otelHooks(tracer, opts?) → SandboxHooks

packages/agent/                   — Agent SDK (published to npm as "@drej/agent")
  src/agent.ts                    — Agent class: load(), resume(), prompt(), bash(), steer(), followUp(), abort(),
                                    newSession(), clone(), fork(), switchSession(), setModel(), cycleModel(),
                                    getMessages(), getAvailableModels(), setThinkingLevel(), cycleThinkingLevel(),
                                    setAutoCompaction(), compact(), setEnv(), getLogs(), close()
  src/adapters/pi.ts              — PiAdapter: BRIDGE_SCRIPT (Node.js CJS HTTP→RPC bridge), install(), configure(),
                                    startBridge(), waitReady(); bridges all Pi RPC commands; emits AgentEvent SSE
  src/schema.ts                   — AgentSpec interface + SetupStep interface + validateAgentSpec()
  src/snapshots.ts                — AgentSnapshotStore, computeSetupHash() (hashes cli+cliVersion+packages+setup)
  src/config.ts                   — DrejAgentConfig, readProjectConfig() (reads drej.config.json)
  src/types.ts                    — AgentEvent (text|tool_start|tool_update|tool_end), AgentStream, textOnly(),
                                    PromptStream (deprecated alias), PiModel, ThinkingLevel, PiMessage, CompactResult
  src/index.ts                    — barrel exports

packages/cli/                     — drejx CLI (published to npm as "drejx", not part of changeset versioning)
  src/index.ts                    — CLI entry point (shebang, command dispatch)
  src/commands/init.ts            — drejx init: starts OpenSandbox in Docker, writes .drej/config.json
  src/commands/add.ts             — drejx add <url>: fetches registry item, builds sandbox, checkpoints
  src/commands/list.ts            — drejx list: prints sandboxes from .drej/sandboxes.json
  src/commands/remove.ts          — drejx remove <name>: deletes sandbox entry
  src/schema.ts                   — RegistryItem interface + validateRegistryItem()
  src/config.ts                   — DrejxConfig, readConfig(), writeConfig(), serverConfigContent()
  src/sandboxes.ts                — SandboxEntry, readSandboxes(), writeSandboxes()
  src/docker.ts                   — checkDocker(), getContainerState(), startContainer(), runContainer(), pollHealth()
```

### Key design points

**Sandbox as first-class object**: `client.sandbox()` returns a live `Sandbox` object. You hold it, call methods on it, and call `sb.close()` when done. Multiple sandboxes → multiple variables. No special API.

**ExecHandle**: `sb.exec("cmd")` returns an `ExecHandle` — a `PromiseLike<ExecResult>` with `pipe()`, `stdout()`, and `result()`. `await sb.exec("cmd")` gives `{ stdout, stderr, exitCode }`. Streaming: `await sb.exec("cmd").pipe(process.stdout)`.

**Durable ledger**: Every exec is logged to the adapter as `exec_start` → `exec_event`s → `exec_complete`. `sb.checkpoint()` snapshots the container and writes `checkpoint_created`. On `client.resume(sandboxId)`: restores from the last snapshot, returns cached results for execs completed before the checkpoint, runs the rest live. Invisible to the user.

**Lazy workflow layer**: `@drej/workflow` provides `workflow(client).sandbox(opts, fn).pipe(sink)`. The `fn` callback receives a `SandboxBuilder` — all methods queue ops synchronously. The queue is flushed when `.pipe()` or `.result()` is awaited. One `await` at the end regardless of workflow complexity.

**Storage adapter**: `DrejOptions.adapter` accepts any `IStorageAdapter`. Pass `new SQLiteAdapter("./drej.db")` for local dev or `new PostgresAdapter(connectionString)` for production. The adapter is initialised lazily on first use — no `connect()` call needed. On process exit, `beforeExit` closes the adapter automatically; explicit teardown is not required for scripts.

**Concurrency limits**: `DrejOptions.maxConcurrency` caps simultaneous active sandboxes. `client.sandbox()` awaits a semaphore slot; the slot is released when `sb.close()` is called.

**Hooks**: `SandboxHooks` provides lifecycle callbacks: `onSandboxCreated`, `onExecStart`, `onExecComplete`, `onCheckpoint`, `onSandboxClosed`, `onSandboxFailed`. Pass via `SandboxOptions.hooks`. Use `otelHooks(tracer)` from `@drej/otel` for OpenTelemetry tracing.

**execd readiness**: OpenSandbox reports a sandbox as "Running" before execd is ready. `resolveExecClient()` calls `getEndpoint()` once (each call returns a different ephemeral proxy port) then polls `listContexts()` until execd responds.

**Sandbox entrypoint**: Always `["tail", "-f", "/dev/null"]` — `/bin/bash` exits immediately without a TTY, killing the container. `client.sandbox()` sets this automatically.

**Resource limits required**: `SandboxOptions.resources` (`{ cpu: string; memory: string; gpu?: string }`) is required — the OpenSandbox server rejects requests without it. Always pass at least `{ cpu: "500m", memory: "256Mi" }`. This applies to `client.sandbox()`, `workflow().sandbox()`, and every step in `workflow().sequence()`.

**Server proxy mode**: When OpenSandbox runs in Docker (via `drejx init`), sandbox containers are on a bridge network and their IPs are unreachable from the host. Set `useServerProxy: true` in `DrejOptions` to route execd and proxy traffic through the server (`?use_server_proxy=true` on `getEndpoint`). The server then returns `{eip}/sandboxes/{id}/proxy/{port}` URLs that are reachable from the host. The server config must have `eip = "http://localhost:8080"` set — `drejx init` writes this automatically.

## Environment variables

`Drej` is configured via constructor options, not environment variables. The consuming application is responsible for reading env vars and passing them in:

| Option | Description |
|---|---|
| `baseUrl` | OpenSandbox server URL (e.g. `http://localhost:8080`) |
| `apiKey` | OpenSandbox API key (empty string for local dev) |
| `adapter` | `IStorageAdapter` implementation (SQLiteAdapter or PostgresAdapter) |
| `maxConcurrency` | Max simultaneous workflow runs (default: unlimited) |
| `useServerProxy` | Route execd/proxy traffic through the server — required when server runs in Docker via `drejx init` (default: `false`) |

## Local OpenSandbox setup

### Option 1 — drejx init (recommended)

`bunx drejx init` starts OpenSandbox in a Docker container (`opensandbox/server:latest`) and writes `~/.config/drejx/server.toml` and `.drej/config.json` automatically. This is the preferred path for users running the full drejx workflow.

When using a server started this way, pass `useServerProxy: true` to `new Drej(...)` — direct container IPs are not reachable from the host over Docker's bridge network.

### Option 2 — uvx (manual)

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

The `uvx` path does not need `useServerProxy` — the server is on the host, so direct container IPs are reachable.

## SDK focus

We are currently focused exclusively on making the **TypeScript SDK** (`packages/sdks/typescript`) full-featured and production-ready. Python SDK is maintained but not the priority. Do not add new features to the Python SDK unless explicitly asked.

## Releases

The TypeScript SDK (`packages/sdks/typescript`) is published to npm via changesets. Every PR that changes publishable packages needs a changeset (`bunx changeset`). CI enforces this. Releases are cut automatically via `changesets/action` on merge to `main`.

> **Changeset must be committed** before CI will pass — `bunx changeset status --since origin/main` reads from git history, not disk.
