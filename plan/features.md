# drej feature plan

Features that are already supported by the OpenSandbox API but not yet surfaced in drej's public interface. All of these require no new infra — just threading through existing API capabilities.

---

## What's already done (confirmed in code)

These were checked in `packages/core/src/sandbox.ts` and `packages/sdks/typescript/src/client.ts` — no work needed:

| Feature | Where |
|---|---|
| `exec({ cwd })` | `ExecOptions.cwd` exists; passed as `cwd: opts.cwd` to `executeCommand` (sandbox.ts:169) |
| `exec({ env })` | `ExecOptions.env` exists; passed as `envs: opts.env` to `executeCommand` (sandbox.ts:169) |
| `sandbox({ env })` | `SandboxOptions.env` exists; passed to `createSandbox` (client.ts:112) |
| `sandbox({ timeout })` | `SandboxOptions.timeout` exists; passed to `createSandbox` (client.ts:116) |

---

## Tier 1 — High value, trivial (one-liners)

### 1. `exec({ timeoutMs })` — exec timeout

**Why:** Long-running or hung commands should be killable without the user managing an `AbortController`.

**API support:** `ExecuteCommandOptions.timeout?: number` already exists in `packages/opensandbox/src/types.ts:156`.

**Changes:**
- `packages/core/src/sandbox.ts` — add `timeoutMs?: number` to `ExecOptions`, pass as `timeout: opts.timeoutMs` alongside `cwd` and `envs` in the `executeCommand` call (line 169).

**No other files need changing.** `ExecOptions` is already exported.

---

### 2. `sb.proxy(port)` — HTTP port proxying

**Why:** Enables web server use cases — start a dev server inside the sandbox, get a URL to send HTTP requests to it.

**API support:** `ControlClient.getEndpoint(sandboxId, port)` already exists in `packages/opensandbox/src/control.ts:104`. Returns `{ endpoint: string; headers?: Record<string, string> }`.

**Changes:**
- `packages/core/src/sandbox.ts` — add one method to `Sandbox`:

```ts
async proxy(port: number): Promise<{ url: string; headers: Record<string, string> }> {
  const ep = await this._deps.control.getEndpoint(this.sandboxId, port);
  const url = ep.endpoint.startsWith("http") ? ep.endpoint : `http://${ep.endpoint}`;
  return { url, headers: ep.headers ?? {} };
}
```

**No other files need changing.** `ControlClient` is already in `SandboxDeps`.

---

### 3. `sb.metrics()` — CPU/memory usage

**Why:** Useful for monitoring sandbox resource consumption during heavy workloads.

**API support:** `ExecClient.getMetrics()` already exists in `packages/opensandbox/src/exec.ts:223`. Returns `{ cpu: number; memory: number; timestamp: string }`.

**Changes:**
- `packages/core/src/sandbox.ts` — add one method to `Sandbox`:

```ts
async metrics(): Promise<{ cpu: number; memory: number; timestamp: string }> {
  const ec = await this._getExecClient();
  return ec.getMetrics();
}
```

- `packages/opensandbox/src/types.ts` — `Metrics` type already exists; export it from `packages/core/src/index.ts` if we want it in the public surface (or just inline the return type).

---

## Tier 2 — Medium value, easy

### 4. `sandbox({ metadata })` — sandbox labels

**Why:** Allows users to tag sandboxes with arbitrary key-value pairs (e.g. `{ runId: "ci-42", env: "staging" }`). Useful for multi-tenant systems or audit trails.

**API support:** `CreateSandboxOptions.metadata?: Record<string, string>` already exists in `packages/opensandbox/src/types.ts:55`. The `Sandbox` object returned by the API already echoes it back.

**Changes:**
- `packages/sdks/typescript/src/types.ts` — add `metadata?: Record<string, string>` to `SandboxOptions`.
- `packages/sdks/typescript/src/client.ts` — pass `metadata: opts.metadata` alongside `env` and `timeout` in the `createSandbox` call (client.ts:111-117).

---

### 5. `sb.createDirectory(path)` / `sb.deleteDirectory(path)`

**Why:** Currently users must run `mkdir -p` via `sb.exec()` to create directories. Direct methods are more ergonomic for file-system-heavy workflows (code editors, project scaffolding).

**API support:** `ExecClient.createDirectory()` and `ExecClient.deleteDirectory()` exist in `packages/opensandbox/src/exec.ts:214-220`.

**Changes:**
- `packages/core/src/sandbox.ts` — add two methods to `Sandbox`:

```ts
async createDirectory(path: string): Promise<void> {
  const ec = await this._getExecClient();
  await ec.createDirectory(path);
}

async deleteDirectory(path: string): Promise<void> {
  const ec = await this._getExecClient();
  await ec.deleteDirectory(path);
}
```

---

### 6. `sb.getFileInfo(path)` — file metadata

**Why:** Lets users check if a file exists, its size, type (file/directory/symlink), permissions, and timestamps without running `stat` via exec.

**API support:** `ExecClient.getFileInfo(path)` exists in `packages/opensandbox/src/exec.ts:151`. Returns `FileInfo { path, type, size, mode, modified_at, created_at, owner, group }`.

**Changes:**
- `packages/core/src/sandbox.ts` — add one method:

```ts
async getFileInfo(path: string): Promise<FileInfo> {
  const ec = await this._getExecClient();
  return ec.getFileInfo(path);
}
```

- `packages/opensandbox/src/types.ts` — `FileInfo` already exists; re-export from core/sdk if surfacing publicly.

---

### 7. `sb.replaceInFiles(replacements)` — in-place search and replace

**Why:** Code-editing agents often need to patch a specific string in a file without a full read-write cycle. A direct API call is faster and more atomic than `readFile` → string replace → `writeFile`.

**API support:** `ExecClient.replaceInFiles(replacements)` exists in `packages/opensandbox/src/exec.ts:171`. Takes `FileReplacement[] = { path, old, new }[]`.

**Changes:**
- `packages/core/src/sandbox.ts` — add one method:

```ts
async replaceInFiles(replacements: Array<{ path: string; old: string; new: string }>): Promise<void> {
  const ec = await this._getExecClient();
  await ec.replaceInFiles(replacements);
}
```

- `packages/opensandbox/src/types.ts` — `FileReplacement` already exists; use it directly or inline the type.

---

## Tier 3 — More work

### 8. `sb.transfer(path, targetSb)` — copy file between sandboxes

**Why:** In fork workflows, the two sandboxes share initial state but diverge. `transfer` lets results flow from one sandbox to another without leaving the process.

**API support:** No dedicated API — implemented as `readFile` from source + `writeFile` to target (two existing methods). Binary content needs the raw stream, so this is slightly more involved than a pure string copy.

**Changes:**
- `packages/core/src/sandbox.ts` — add a method that reads the raw `ReadableStream` from `ExecClient.downloadFile()` and pipes it into `ExecClient.uploadFile()` on the target sandbox:

```ts
async transfer(path: string, target: Sandbox): Promise<void> {
  const content = await this.readFile(path);
  await target.writeFile(path, content);
}
```

For binary files, we'd need to expose a raw `downloadFile()` returning a stream and a `uploadFile()` accepting `Blob | BufferSource`. For now, the string-based version covers the common case (text files, scripts, JSON).

---

## Implementation order

| # | Feature | Files touched | Effort |
|---|---|---|---|
| 1 | `exec({ timeoutMs })` | `sandbox.ts` only | 2 lines |
| 2 | `sb.proxy(port)` | `sandbox.ts` only | 5 lines |
| 3 | `sb.metrics()` | `sandbox.ts` only | 4 lines |
| 4 | `sandbox({ metadata })` | `types.ts`, `client.ts` | 3 lines |
| 5 | `sb.createDirectory()` / `sb.deleteDirectory()` | `sandbox.ts` only | 8 lines |
| 6 | `sb.getFileInfo(path)` | `sandbox.ts` only | 4 lines |
| 7 | `sb.replaceInFiles()` | `sandbox.ts` only | 4 lines |
| 8 | `sb.transfer(path, target)` | `sandbox.ts` only | 5 lines |

All 8 can ship in a single PR. They are independent of each other. Total changeset: one `minor` bump on `drej`.

---

## Files that need changes

```
packages/core/src/sandbox.ts          — methods 1–3, 5–8 (ExecOptions + Sandbox methods)
packages/sdks/typescript/src/types.ts — method 4 (SandboxOptions.metadata)
packages/sdks/typescript/src/client.ts — method 4 (pass metadata to createSandbox)
```

Exports: `FileInfo` and `Metrics` types may need re-exporting from `packages/core/src/index.ts` and `packages/sdks/typescript/src/client.ts` depending on whether we want them in the public surface. Recommend yes for `FileInfo` (return type of `getFileInfo`), less critical for `Metrics` (can inline).
