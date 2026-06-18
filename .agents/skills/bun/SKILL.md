---
name: Bun
description: Use when building JavaScript/TypeScript applications, managing packages, running tests, bundling code, or creating HTTP servers. Reach for Bun when you need a fast, all-in-one toolkit that replaces Node.js, npm, Jest, and esbuild.
metadata:
    mintlify-proj: bun
    version: "1.0"
---

# Bun Skill Reference

## Product Summary

Bun is an all-in-one JavaScript/TypeScript toolkit that ships as a single binary. It includes a runtime (drop-in Node.js replacement), package manager (25x faster than npm), test runner (Jest-compatible), and bundler. Use `bun run` to execute files, `bun install` to manage packages, `bun test` to run tests, and `bun build` to bundle code. Key config file: `bunfig.toml` (optional, zero-config by default). Primary docs: https://bun.com/docs

## When to Use

- **Runtime tasks**: Execute TypeScript/JSX files directly without compilation overhead (`bun run index.ts`)
- **Package management**: Install dependencies 25x faster than npm with `bun install`
- **Testing**: Write Jest-compatible tests with `bun test` for fast feedback loops
- **Bundling**: Bundle JavaScript/TypeScript for browsers or servers with `bun build`
- **HTTP servers**: Build high-performance servers with `Bun.serve()` and native routing
- **Monorepos**: Manage workspaces with `bun install --filter` and workspace scripts
- **File I/O**: Read/write files with optimized `Bun.file()` and `Bun.write()` APIs
- **Replacing Node.js**: Use as a drop-in replacement in existing Node.js projects

## Quick Reference

### Essential Commands

| Task | Command |
|------|---------|
| Run a file | `bun run index.ts` or `bun index.ts` |
| Run a script | `bun run dev` (from package.json scripts) |
| Install dependencies | `bun install` |
| Add a package | `bun add react` |
| Remove a package | `bun remove react` |
| Run tests | `bun test` |
| Watch tests | `bun test --watch` |
| Build/bundle | `bun build ./index.ts --outdir ./dist` |
| Create new project | `bun init my-app` |
| Execute package binary | `bunx cowsay "Hello"` |

### Configuration Files

| File | Purpose |
|------|---------|
| `bunfig.toml` | Bun-specific config (optional, zero-config default) |
| `package.json` | Project metadata, scripts, dependencies |
| `tsconfig.json` | TypeScript configuration |
| `bun.lock` | Lockfile (text-based, replaces package-lock.json) |

### Key Bun APIs

| API | Purpose |
|-----|---------|
| `Bun.serve()` | Start HTTP server with routing |
| `Bun.file()` | Read files efficiently |
| `Bun.write()` | Write files efficiently |
| `Bun.spawn()` | Spawn child processes |
| `Bun.env` | Access environment variables |
| `Bun.build()` | Programmatic bundling |

## Decision Guidance

### When to Use `bun run` vs `bun`

| Scenario | Use |
|----------|-----|
| Running a file directly | `bun index.ts` (shorter) |
| Running a package.json script | `bun run dev` (explicit) |
| Running a system command | `bun run ls` (explicit) |
| Ambiguous name (could be script or file) | `bun run <name>` (prioritizes scripts) |

### Installation Strategy: Hoisted vs Isolated

| Strategy | Use When |
|----------|----------|
| **Hoisted** (default for new projects) | You want traditional npm behavior, flat node_modules |
| **Isolated** (default for workspaces) | You need strict dependency isolation, prevent phantom deps |

Set with: `bun install --linker hoisted` or `--linker isolated`

### Package Manager: When to Use Flags

| Flag | Use When |
|------|----------|
| `--production` | Installing for production (skip devDependencies) |
| `--frozen-lockfile` | CI/CD: ensure exact versions from lockfile |
| `--dry-run` | Preview install without writing to disk |
| `--filter` | Monorepo: install for specific packages only |

### Test Runner: Serial vs Concurrent

| Mode | Use When |
|------|----------|
| **Sequential** (default) | Tests share state or have dependencies |
| **Concurrent** (`--concurrent`) | Tests are independent, need speed |
| **test.serial** | One test must run in order despite `--concurrent` |

### Bundler: Target Selection

| Target | Use When |
|--------|----------|
| `browser` (default) | Building for web browsers |
| `bun` | Building for Bun runtime (server code) |
| `node` | Building for Node.js compatibility |

## Workflow

### 1. Initialize a Project
```bash
bun init my-app
cd my-app
```
Bun creates `package.json`, `tsconfig.json`, and `index.ts`.

### 2. Install Dependencies
```bash
bun install
# or add specific packages
bun add react
bun add -d @types/react
```
Creates `bun.lock` (text-based lockfile).

### 3. Write Code
- Use TypeScript/JSX directly—no compilation step needed
- Import JSON, TOML, YAML files directly
- Use `Bun.serve()` for HTTP servers, `Bun.file()` for file I/O

### 4. Run Code
```bash
bun run index.ts
# or run package.json scripts
bun run dev
```

### 5. Write Tests
Create `*.test.ts` files with Jest-like API:
```typescript
import { test, expect, describe } from "bun:test";

describe("math", () => {
  test("2 + 2 = 4", () => {
    expect(2 + 2).toBe(4);
  });
});
```

### 6. Run Tests
```bash
bun test
bun test --watch
bun test --coverage
```

### 7. Bundle for Production
```bash
bun build ./index.ts --outdir ./dist
# or with options
bun build ./index.ts --outdir ./dist --minify --sourcemap linked
```

### 8. Configure (Optional)
Create `bunfig.toml` for Bun-specific settings:
```toml
[install]
linker = "isolated"

[test]
coverage = true

[run]
shell = "bun"
```

## Common Gotchas

- **Flag placement**: Put Bun flags immediately after `bun`, not at the end: `bun --watch run dev` ✓, `bun run dev --watch` ✗
- **Lifecycle scripts**: By default, Bun does NOT run `postinstall` scripts for security. Add packages to `trustedDependencies` in `package.json` to allow them.
- **Node.js compatibility**: Bun aims for Node.js compatibility but is not 100% complete. Check the [compatibility page](/runtime/nodejs-compat) for your specific APIs.
- **Auto-install disabled by default in production**: Set `[install] auto = "disable"` in `bunfig.toml` if you don't want Bun to auto-install missing packages at runtime.
- **Lockfile format changed**: Bun v1.2+ uses text-based `bun.lock` instead of binary `bun.lockb`. Old lockfiles auto-upgrade.
- **TypeScript types**: If you see type errors on the `Bun` global, install `@types/bun` and add `"lib": ["ESNext"]` to `tsconfig.json`.
- **Peer dependencies**: Bun installs peer dependencies by default (unlike npm). Disable with `[install] peer = false` in `bunfig.toml`.
- **Test file discovery**: Tests must match patterns like `*.test.ts`, `*.spec.ts`, `*_test.ts`, `*_spec.ts` to be discovered.
- **Minification**: When targeting `bun`, identifiers are minified by default. Use `minify: false` to disable.
- **External imports**: Mark packages as external in bundler to exclude them from bundles: `external: ["lodash"]`.

## Verification Checklist

Before submitting work with Bun:

- [ ] Code runs without errors: `bun run index.ts`
- [ ] All tests pass: `bun test` (or `bun test --watch` during development)
- [ ] Dependencies are installed: `bun install` (lockfile committed)
- [ ] TypeScript has no errors: `bunx tsc --noEmit` (if using TypeScript)
- [ ] Configuration is valid: Check `bunfig.toml` syntax if present
- [ ] Bundled output is correct: `bun build` produces expected files
- [ ] No lifecycle script warnings: Check `bun install` output for security warnings
- [ ] Environment variables are set: Verify `.env` files or CI/CD env vars
- [ ] Monorepo filters work: `bun run --filter 'package-name' test` (if applicable)
- [ ] Performance is acceptable: Check startup time and bundle size

## Resources

- **Comprehensive navigation**: https://bun.com/docs/llms.txt (page-by-page reference for all docs)
- **Runtime API**: https://bun.com/docs/runtime (file I/O, HTTP, environment, child processes)
- **Package Manager**: https://bun.com/docs/pm/cli/install (install, add, remove, workspaces)
- **Test Runner**: https://bun.com/docs/test (writing tests, mocking, snapshots, coverage)
- **Bundler**: https://bun.com/docs/bundler (build options, plugins, code splitting)

---

> For additional documentation and navigation, see: https://bun.com/docs/llms.txt