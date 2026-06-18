# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> For any questions about the OpenSandbox API, behavior, or internals, use the DeepWiki MCP tool (`mcp__deepwiki__ask_question`) against `https://deepwiki.com/opensandbox-group/OpenSandbox/`.

## Agent Skills

Reusable skill references live in `.agents/skills/<name>/SKILL.md`. Always check this folder before reaching for external docs — skills contain curated quick references and gotchas specific to tools used in this repo.

Available skills:

- **`.agents/skills/bun/`** — Bun runtime, package manager, test runner, and bundler. Covers `bun run`, `bun install`, `bun test`, `bun build`, workspace flags, common gotchas (flag placement, lifecycle scripts, lockfile format), and key APIs (`Bun.file()`, `Bun.serve()`, `Bun.write()`).

Example: before writing a `bun build` command or debugging a workspace install issue, read `.agents/skills/bun/SKILL.md` for the correct flags and known pitfalls.

## What this is

`drej` is a lightweight workflow orchestration engine built on top of [OpenSandbox](https://opensandbox.ai). It lets you define multi-step workflows that run inside isolated sandbox containers. Steps can create sandboxes, execute code or shell commands, and delete sandboxes. The API streams results via SSE and writes a durable NDJSON ledger to support resumption.

## Commands

```bash
# Start API server in watch mode (hot reload)
bun run dev

# Run the hello-world example against a local server
bun run examples/hello-world.ts

# Typecheck each package individually (CI runs these)
bunx tsc --noEmit --strict   # from packages/internal/opensandbox
bunx tsc --noEmit --strict   # from packages/core
bunx tsc --noEmit --strict   # from apps/api
bunx tsc --noEmit --strict   # from packages/sdks/typescript

# Run API directly (no watch)
bun run apps/api/src/index.ts

# Docker
docker build -t drej-api .
docker run --rm --network=host \
  -e OPEN_SANDBOX_BASE_URL=http://localhost:8080 \
  -e OPEN_SANDBOX_API_KEY="" \
  drej-api

# Changesets (required on every PR touching publishable packages)
bunx changeset        # add a changeset
bunx changeset status # verify one exists

# IMPORTANT: after committing code changes, always add and commit a changeset too.
# The CI changeset check (bunx changeset status --since origin/main) reads from
# git history — an uncommitted changeset file will NOT satisfy it.
```

## Architecture

```
packages/core/          — Port interfaces only (no runtime deps)
  types.ts              — ISandboxControl, IExecClientFactory, ISandboxExec
  ledger.ts             — ILedger, MemoryLedger, NdjsonLedger
  workflow.ts           — Workflow class (run, rollback, resumeFromLedger)

packages/internal/opensandbox/   — Concrete OpenSandbox HTTP clients
  control.ts            — ControlClient (sandbox lifecycle via REST)
  exec.ts               — ExecClient (code/command execution via SSE)

apps/api/src/index.ts   — Elysia HTTP server; wires adapters → core ports
  - Injects ControlClient + ExecClient into WorkflowDeps
  - Defines StepDef union and buildStep() factory
  - workflowSseResponse(): tee ledger (NdjsonLedger + live SSE)
  - POST /v1/workflows, POST /v1/workflows/:id/resume, GET /v1/workflows/:id/ledger

packages/sdks/typescript/  — Public TypeScript SDK (published to npm as "drej")
packages/sdks/python/      — Public Python SDK
```

### Key design points

**Microkernel / hexagonal**: `packages/core` defines abstract ports (`ISandboxControl`, `IExecClientFactory`, `ILedger`). `apps/api` injects the concrete OpenSandbox adapters. The core never imports from `apps/` or `packages/internal/`.

**Tee ledger**: `workflowSseResponse` wraps `NdjsonLedger` in a proxy that writes every `LedgerEntry` to disk AND streams it to the SSE response simultaneously. All exec output flows through `ctx.emit()` as `exec_event` entries.

**Workflow state**: Steps pass a `WorkflowState` object (plain record) as the return value. `sandboxId` is set by `create_sandbox` and consumed by `exec_code`, `exec_command`, and `delete_sandbox`. Each step receives the previous step's output as `input`.

**Saga rollback**: If any step throws, `Workflow.rollback()` runs completed steps in reverse. `create_sandbox` has a rollback that calls `deleteSandbox`, preventing sandbox leaks on failure.

**Resumption**: `Workflow.resumeFromLedger()` reads the last `checkpoint` entry from the NDJSON ledger to reconstruct completed-step state and restart from the next step.

**execd readiness**: OpenSandbox reports a sandbox as "Running" before the execd process inside is ready to accept connections. `resolveExecClient()` calls `getEndpoint()` exactly once (each call returns a different ephemeral proxy port) then polls `listContexts()` until execd responds.

**Sandbox entrypoint**: Use `["tail", "-f", "/dev/null"]` as the sandbox entrypoint — `/bin/bash` exits immediately without a TTY, killing the container.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPEN_SANDBOX_BASE_URL` | `http://localhost:8080` | OpenSandbox server URL |
| `OPEN_SANDBOX_API_KEY` | required | API key (empty string for local) |
| `PORT` | `6000` | API server port |
| `LEDGER_PATH` | `./drej.ndjson` | NDJSON ledger file path |

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
