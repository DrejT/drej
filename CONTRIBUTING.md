# Contributing to drej

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [Docker](https://docs.docker.com/get-docker/) (for integration tests)
- [uv](https://github.com/astral-sh/uv) (for running the OpenSandbox server via `uvx`)

## Local setup

```bash
git clone https://github.com/DrejT/drej.git
cd drej
bun install
bun run build
```

## Running tests

**Unit tests** (no sandbox required):

```bash
bun run test
```

**Integration tests** (requires a running OpenSandbox server):

```bash
# Start the server
uvx opensandbox-server

# In another terminal
bun run test:integration
```

See `CLAUDE.md` for the full local OpenSandbox configuration (`~/.sandbox.toml`).

## Type checking

```bash
bun run typecheck
```

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add tests for new behaviour
4. Run `bun run typecheck && bun run test`
5. Add a changeset if your change touches a publishable package:

```bash
bunx changeset
```

Choose `minor` for new features, `patch` for bug fixes. The changeset must be committed — CI will fail without it.

6. Open a pull request against `main`

## Package structure

| Package | Description |
|---|---|
| `packages/core` | `Sandbox` class, ledger types, storage adapter interface |
| `packages/sdks/typescript` | Public `drej` npm package — `Drej` client |
| `packages/opensandbox` | OpenSandbox HTTP clients (control + exec) |
| `packages/workflow` | `@drej/workflow` — lazy workflow builder |
| `packages/adapters/sqlite` | `@drej/sqlite` — SQLite storage adapter |
| `packages/adapters/postgres` | `@drej/postgres` — Postgres storage adapter |
| `packages/adapters/otel` | `@drej/otel` — OpenTelemetry hooks adapter |
| `examples/*` | Runnable examples (also serve as integration tests) |

## Commit style

Plain English imperative: `add sb.fork()`, `fix CommandError on non-zero exit`, `update snapshot docs`.

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md).
