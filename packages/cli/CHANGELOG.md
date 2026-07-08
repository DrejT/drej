# drejx

## 0.5.0

### Minor Changes

- 4cfe868: Restructure `drejx` into three clean layers per `plans/drejx-layers.md`:

  - **CLI**: renamed `ps` → `agents`, removed the interactive `attach` REPL, added
    `drejx prompt <name> <message>` (send one message to a running session, get the
    reply, no terminal needed), and `--json` on `run`/`prompt`/`agents`/`logs` for
    machine-readable output. `run` no longer attaches interactively — it starts a
    session, optionally sends a first prompt via `--prompt`, and exits.
  - **TUI**: bare `drejx` now includes a new-session launcher (browse local specs +
    the registry.drej.dev catalog, pick one, it fetches and runs) and a logs view,
    alongside the existing dashboard and chat view. The dashboard also gains a
    `k` kill action.
  - **Pi extension**: `packages/cli/pi-extension/drejx.ts`, shipped with the npm
    package, registers `drejx_run`/`drejx_prompt`/`drejx_agents`/`drejx_kill` as
    typed Pi tools — lets a Pi agent orchestrate child drejx sessions without
    hand-rolling `osb` bash commands.

  Breaking CLI changes (`ps` renamed, `attach` removed) — low-stakes since `drejx`
  has no meaningful external adoption yet.

## 0.4.0

### Minor Changes

- 9181b8e: Add tmux-style session commands: `drejx run <spec> [--detach] [--rebuild]`, `drejx ps`, `drejx attach <name>`, `drejx kill <name>`, `drejx logs <name>`. Bare `drejx` in a terminal now launches an interactive TUI (built on `@opentui/core`) with a dashboard of running sessions and a chat view. Existing `init`/`add`/`list`/`remove` commands are unchanged.

## 0.3.0

### Minor Changes

- 2adcea6: Add tmux-style session commands: `drejx run <spec> [--detach] [--rebuild]`, `drejx ps`, `drejx attach <name>`, `drejx kill <name>`, `drejx logs <name>`. Bare `drejx` in a terminal now launches an interactive TUI (built on `@opentui/core`) with a dashboard of running sessions and a chat view. Existing `init`/`add`/`list`/`remove` commands are unchanged.

### Patch Changes

- Updated dependencies [b7aaa2f]
- Updated dependencies [5055755]
- Updated dependencies [9cc6b08]
- Updated dependencies [13b826b]
- Updated dependencies [fa18120]
- Updated dependencies [b2d7096]
  - @drej/agent@0.4.0
  - drej@0.10.0
  - @drej/opensandbox@0.3.0
  - @drej/sqlite@0.3.5

## 0.2.4

### Patch Changes

- a4856f1: Fix every published package that depends on a sibling workspace package shipping a literal `"workspace:*"` version string instead of a real semver range.

  `changeset publish` always shells out to plain `npm publish`, which has no concept of the `workspace:` protocol — unlike `bun publish`/`pnpm publish`, which resolve it automatically. Every currently published version of `drej`, `@drej/agent`, `@drej/workflow`, and `drejx` has `"workspace:*"` in its `dependencies`, which `npm install` cannot resolve at all (`EUNSUPPORTEDPROTOCOL`). Installing any of these packages from npm fails outright.

  Added `scripts/resolve-workspace-protocol.ts`, run in CI immediately before `npm publish`, which rewrites every `workspace:*`/`workspace:^`/`workspace:~` dependency range to the corresponding package's already-resolved version before the tarball is packed.

- Updated dependencies [a4856f1]
  - drej@0.9.3
  - @drej/sqlite@0.3.4
  - @drej/agent@0.3.2

## 0.2.3

### Patch Changes

- a91651c: Fix npm publish failures and a broken `drejx` CLI build:

  - Add the missing `repository` field to every published package's `package.json`. Without it, npm rejects publishes with `provenance: true` enabled (added previously) — every package failed to publish with a 422 "Error verifying sigstore provenance bundle" (see the last "Version Packages" release run).
  - Add `packages/cli` to the root `build` script. It was never built by CI before publish, so every previously-published `drejx` version (up to and including 0.2.1 on npm) shipped with no `dist/` folder at all — the CLI has never actually worked when installed from npm.
  - Remove a duplicate shebang in `packages/cli/tsdown.config.ts`'s `banner` config (the source file already has its own `#!/usr/bin/env bun`), which produced a syntactically broken `dist/index.mjs` whenever the package _was_ built manually.
  - Add `packages/agent` and `packages/cli` to the root `typecheck` script — both were previously only checked ad hoc.

- Updated dependencies [a91651c]
  - drej@0.9.2
  - @drej/sqlite@0.3.3
  - @drej/agent@0.3.1

## 0.2.2

### Patch Changes

- 34cfa8b: Add the missing `license` field (Apache-2.0) to every published package's `package.json`, matching the repo's root `LICENSE` file.
- 3f362d1: Enable npm provenance for published packages.
- Updated dependencies [34cfa8b]
- Updated dependencies [fdc25db]
- Updated dependencies [cf9af70]
- Updated dependencies [bca2a6b]
- Updated dependencies [7fb9d35]
- Updated dependencies [3f362d1]
  - drej@0.9.1
  - @drej/sqlite@0.3.2
  - @drej/agent@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [a0c1eee]
- Updated dependencies [f803858]
- Updated dependencies [3f55f48]
- Updated dependencies [e9a9110]
- Updated dependencies [b773030]
- Updated dependencies [c81c77d]
  - drej@0.9.0
  - @drej/agent@0.2.0
  - @drej/sqlite@0.3.1

## 0.2.0

### Minor Changes

- 10417e3: feat: add drejx CLI with Docker-based OpenSandbox init and registry support; add useServerProxy option to Drej client

### Patch Changes

- Updated dependencies [2c2eb16]
- Updated dependencies [10417e3]
- Updated dependencies [5a63143]
- Updated dependencies [416bc72]
- Updated dependencies [f83ccf2]
- Updated dependencies [0398728]
- Updated dependencies [4f79c8e]
- Updated dependencies [2ed4de7]
- Updated dependencies [02bcb01]
- Updated dependencies [2bbd8dc]
- Updated dependencies [599d707]
  - @drej/agent@0.1.1
  - drej@0.8.0
  - @drej/sqlite@0.3.0
