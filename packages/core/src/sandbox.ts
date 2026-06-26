import { ExecClient, SnapshotState } from "@drej/opensandbox";
import type { ControlClient, SSEEvent } from "@drej/opensandbox";
import { SandboxError, ExecConnectionError, CommandError } from "./errors";
import type { IStorageAdapter, CheckpointInfo } from "./ledger";
import { LedgerEvent } from "./ledger";
import { ExecHandle, type ExecResult } from "./exec-handle";

export interface ExecOptions {
  /** Working directory inside the sandbox. */
  cwd?: string;
  /** Environment variables to set for this exec. */
  env?: Record<string, string>;
  /** Abort the command after this many milliseconds. */
  timeoutMs?: number;
  /**
   * Throw `CommandError` if the command exits with a non-zero code.
   * Defaults to `true`.
   */
  strict?: boolean;
  /**
   * Path to the shell binary used to execute the command.
   * Overrides the sandbox-level default set in `SandboxOptions.shell`.
   * Defaults to `"/bin/sh"`.
   */
  shell?: string;
}

export interface ExecCodeOptions {
  /** Execution context (stateful interpreter session). */
  context?: { id: string; language: import("@drej/opensandbox").CodeLanguage };
}

/** Lifecycle hooks for observability. Pass via `SandboxDeps.hooks`. */
export interface SandboxHooks {
  onSandboxCreated?(sandboxId: string, name: string): void;
  onExecStart?(sandboxId: string, seq: number, cmd: string): void;
  onExecComplete?(sandboxId: string, seq: number, result: ExecResult): void;
  onCheckpoint?(sandboxId: string, snapshotId: string, name?: string): void;
  onSandboxClosed?(sandboxId: string): void;
  onSandboxFailed?(sandboxId: string, error: Error): void;
}

/** Internal dependencies injected by `DrejClient`. */
export interface SandboxDeps {
  control: ControlClient;
  adapter: IStorageAdapter;
  hooks?: SandboxHooks;
  /** Called when `close()` completes — used by `Drej` for concurrency accounting. */
  onClose?: () => void;
  /** Default shell for all `exec()` calls on this sandbox. Defaults to `"/bin/sh"`. */
  shell?: string;
  /** Called by `fork()` to create a new Sandbox from a snapshot — injected by `Drej`. */
  fork?: (snapshotId: string, tag?: string) => Promise<Sandbox>;
  /** Route execd and proxy calls through the OpenSandbox server. Required when the server runs in Docker. */
  useServerProxy?: boolean;
}

/**
 * Resolve an ExecClient for a sandbox. Calls getEndpoint once (each call
 * returns a different ephemeral proxy port) then polls listContexts until
 * execd is ready to accept connections.
 */
export async function resolveExecClient(
  control: ControlClient,
  sandboxId: string,
  useServerProxy?: boolean,
  retries = 15,
  delayMs = 1_000,
): Promise<ExecClient> {
  const ep = await control.getEndpoint(sandboxId, 44772, useServerProxy);
  const baseUrl = ep.endpoint.startsWith("http") ? ep.endpoint : `http://${ep.endpoint}`;
  const token = ep.headers?.["X-EXECD-ACCESS-TOKEN"] ?? "";
  const client = new ExecClient({ baseUrl, accessToken: token });
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await client.listContexts();
      return client;
    } catch {
      if (attempt === retries) throw new ExecConnectionError(sandboxId);
      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("unreachable");
}

/**
 * A live sandbox container. Returned by `DrejClient.sandbox()` and `DrejClient.resume()`.
 *
 * Call `exec()` to run commands, `checkpoint()` to snapshot state, and `close()`
 * when done. Multiple sandboxes can be held simultaneously — just assign to
 * different variables.
 *
 * @example
 * ```ts
 * const sb = await client.sandbox({ image: "node:22", resources: { cpu: "500m", memory: "256Mi" } });
 * await sb.exec("npm ci");
 * await sb.checkpoint();
 * await sb.exec("npm test").pipe(process.stdout);
 * await sb.close();
 * ```
 */
export class Sandbox {
  /** OpenSandbox container ID — also the unique ledger key for this session. */
  readonly sandboxId: string;
  /** User-provided name (or auto-generated). */
  readonly name: string;

  private readonly _deps: SandboxDeps;
  /** Cached exec results for replay mode (populated by DrejClient.resume()). */
  private readonly _replayCache: Map<number, ExecResult>;
  private _execClient: ExecClient | null = null;
  private _seq = 0;
  private _closed = false;

  constructor(
    sandboxId: string,
    name: string,
    deps: SandboxDeps,
    replayCache: Map<number, ExecResult> = new Map(),
  ) {
    this.sandboxId = sandboxId;
    this.name = name;
    this._deps = deps;
    this._replayCache = replayCache;
  }

  private async _getExecClient(): Promise<ExecClient> {
    if (!this._execClient) {
      this._execClient = await resolveExecClient(this._deps.control, this.sandboxId, this._deps.useServerProxy);
    }
    return this._execClient;
  }

  private async _emit(event: LedgerEvent, stepIndex: number, payload?: unknown): Promise<void> {
    await this._deps.adapter.append({
      ts: Date.now(),
      name: this.name,
      sandboxId: this.sandboxId,
      stepIndex,
      event,
      payload,
    });
  }

  /**
   * Execute a shell command inside the sandbox.
   *
   * Returns an `ExecHandle` — await it for the result, call `.pipe()` to stream
   * stdout, or use `.stdout()` as an async generator. Every call is logged to
   * the ledger; replayed execs in a resumed sandbox return cached output
   * instantly without re-running.
   *
   * @example
   * ```ts
   * const { exitCode } = await sb.exec("npm test");
   * await sb.exec("npm run build").pipe(process.stdout);
   * ```
   */
  exec(cmd: string, opts: ExecOptions = {}): ExecHandle {
    const seq = ++this._seq;

    if (this._replayCache.has(seq)) {
      return new ExecHandle({ type: "replay", result: this._replayCache.get(seq)! });
    }

    const self = this;
    async function* stream(): AsyncGenerator<SSEEvent> {
      const execClient = await self._getExecClient();
      await self._emit(LedgerEvent.ExecStart, seq, { cmd, seq });
      self._deps.hooks?.onExecStart?.(self.sandboxId, seq, cmd);
      // base64-encode so newlines/special chars survive the JSON boundary
      const sh = opts.shell ?? self._deps.shell ?? "/bin/sh";
      const command = `echo ${Buffer.from(cmd).toString("base64")} | base64 -d | ${sh}`;
      for await (const ev of execClient.executeCommand({ command, cwd: opts.cwd, envs: opts.env, timeout: opts.timeoutMs })) {
        await self._emit(LedgerEvent.ExecEvent, seq, { seq, ...ev });
        yield ev;
      }
    }

    return new ExecHandle({
      type: "stream",
      gen: stream(),
      onDone: async (result) => {
        await self._emit(LedgerEvent.ExecComplete, seq, { exitCode: result.exitCode, seq });
        self._deps.hooks?.onExecComplete?.(self.sandboxId, seq, result);
        if (opts.strict !== false && result.exitCode !== 0) {
          throw new CommandError(result.exitCode, cmd, self.sandboxId);
        }
      },
    });
  }

  /**
   * Create a code execution context for use with `execCode()`.
   *
   * The code interpreter requires a context for every `execCode()` call. Call
   * this once per session (or once per isolated scope), then pass the returned
   * object as `opts.context` to `execCode()`. Variables defined in one call
   * are visible to subsequent calls sharing the same context.
   *
   * @example
   * ```ts
   * const ctx = await sb.createCodeContext(CodeLanguage.Python);
   * await sb.execCode('x = 42', { context: ctx });
   * await sb.execCode('print(x)', { context: ctx }); // prints 42
   * ```
   */
  async createCodeContext(language: import("@drej/opensandbox").CodeLanguage): Promise<import("@drej/opensandbox").CodeContext> {
    const ec = await this._getExecClient();
    return ec.createContext(language as string);
  }

  /**
   * Execute code via the sandbox's code interpreter (Python, JS, etc.).
   *
   * Uses the execd `/code` endpoint for stateful, Jupyter-style execution.
   * Contexts persist across calls — use `opts.context` to target a specific one.
   * Create a context first with `sb.createCodeContext(language)`.
   */
  execCode(code: string, opts: ExecCodeOptions = {}): ExecHandle {
    const seq = ++this._seq;

    if (this._replayCache.has(seq)) {
      return new ExecHandle({ type: "replay", result: this._replayCache.get(seq)! });
    }

    const self = this;
    async function* stream(): AsyncGenerator<SSEEvent> {
      const execClient = await self._getExecClient();
      await self._emit(LedgerEvent.ExecStart, seq, { code, seq });
      for await (const ev of execClient.executeCode({ code, context: opts.context })) {
        await self._emit(LedgerEvent.ExecEvent, seq, { seq, ...ev });
        yield ev;
      }
    }

    return new ExecHandle({
      type: "stream",
      gen: stream(),
      onDone: async (result) => {
        await self._emit(LedgerEvent.ExecComplete, seq, { exitCode: result.exitCode, seq });
      },
    });
  }

  /** Write a file into the sandbox. */
  async writeFile(path: string, content: string): Promise<void> {
    const ec = await this._getExecClient();
    await ec.uploadFile(path, content);
  }

  /** Read a file from the sandbox as a UTF-8 string. */
  async readFile(path: string): Promise<string> {
    const ec = await this._getExecClient();
    const stream = await ec.downloadFile(path);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(merged);
  }

  /** Delete a file from the sandbox. */
  async deleteFile(path: string): Promise<void> {
    const ec = await this._getExecClient();
    await ec.deleteFile(path);
  }

  /** Move or rename a file inside the sandbox. */
  async moveFile(from: string, to: string): Promise<void> {
    const ec = await this._getExecClient();
    await ec.moveFile(from, to);
  }

  /** List files in a directory inside the sandbox. */
  async listDirectory(path: string, opts: { depth?: number } = {}) {
    const ec = await this._getExecClient();
    return ec.listDirectory(path, opts.depth);
  }

  /** Search for files matching a glob pattern inside the sandbox. */
  async searchFiles(pattern: string, path = "/") {
    const ec = await this._getExecClient();
    return ec.searchFiles(pattern, path);
  }

  /** Create a directory (and parents) inside the sandbox. */
  async createDirectory(path: string): Promise<void> {
    const ec = await this._getExecClient();
    await ec.createDirectory(path);
  }

  /** Delete a directory inside the sandbox. */
  async deleteDirectory(path: string): Promise<void> {
    const ec = await this._getExecClient();
    await ec.deleteDirectory(path);
  }

  /** Return metadata for a file or directory (size, type, mode, timestamps). */
  async getFileInfo(path: string): Promise<import("@drej/opensandbox").FileInfo> {
    const ec = await this._getExecClient();
    return ec.getFileInfo(path);
  }

  /**
   * Replace substrings in one or more files inside the sandbox.
   *
   * More efficient than `readFile` → string replace → `writeFile` for targeted edits.
   *
   * @example
   * ```ts
   * await sb.replaceInFiles([{ path: "/app/config.json", old: "localhost", new: "0.0.0.0" }]);
   * ```
   */
  async replaceInFiles(replacements: Array<{ path: string; old: string; new: string }>): Promise<void> {
    const ec = await this._getExecClient();
    await ec.replaceInFiles(replacements);
  }

  /**
   * Copy a file from this sandbox into another sandbox.
   *
   * Reads the file as a UTF-8 string and writes it to the same path on the target.
   * Use this to move results between a fork and its origin, or between parallel sandboxes.
   *
   * @example
   * ```ts
   * await sb.transfer("/app/output.json", fork);
   * ```
   */
  async transfer(path: string, target: Sandbox): Promise<void> {
    const content = await this.readFile(path);
    await target.writeFile(path, content);
  }

  /**
   * Return a proxied URL and auth headers for a port inside the sandbox.
   *
   * Use this to send HTTP requests to a server running inside the sandbox.
   *
   * @example
   * ```ts
   * await sb.exec("node server.js &");
   * const { url, headers } = await sb.proxy(3000);
   * const res = await fetch(`${url}/health`, { headers });
   * ```
   */
  async proxy(port: number): Promise<{ url: string; headers: Record<string, string> }> {
    const ep = await this._deps.control.getEndpoint(this.sandboxId, port, this._deps.useServerProxy);
    const url = ep.endpoint.startsWith("http") ? ep.endpoint : `http://${ep.endpoint}`;
    return { url, headers: ep.headers ?? {} };
  }

  /** Return current CPU and memory usage for this sandbox. */
  async metrics(): Promise<{ cpu: number; memory: number; timestamp: string }> {
    const ec = await this._getExecClient();
    return ec.getMetrics();
  }

  /** Return all checkpoints for this sandbox in creation order. */
  listCheckpoints(): Promise<CheckpointInfo[]> {
    return this._deps.adapter.listCheckpoints(this.name, this.sandboxId);
  }

  /**
   * Snapshot the current sandbox and return a new independent `Sandbox` from that state.
   *
   * The original sandbox keeps running. Both operate on separate containers restored
   * from the same snapshot. Equivalent to `checkpoint()` followed by `resume()` on a
   * clone, but without closing the original.
   *
   * @example
   * ```ts
   * await sb.exec("npm ci");
   * const fork = await sb.fork("after-install");
   *
   * await sb.exec("npm test");         // runs on original
   * await fork.exec("npm run build");  // runs on fork
   * ```
   */
  async fork(tag?: string): Promise<Sandbox> {
    if (!this._deps.fork) throw new SandboxError("fork() is not supported on this sandbox", this.sandboxId);
    const snap = await this._deps.control.createSnapshot(this.sandboxId);
    await this._waitForSnapshot(snap.id);
    await this._emit(LedgerEvent.CheckpointCreated, -1, { snapshotId: snap.id, name: tag });
    this._deps.hooks?.onCheckpoint?.(this.sandboxId, snap.id, tag);
    return this._deps.fork(snap.id, tag);
  }

  /**
   * Capture a snapshot of the sandbox's current filesystem state.
   *
   * Writes a `checkpoint_created` event to the ledger with the snapshot ID.
   * Use `DrejClient.resume(sandboxId)` to restore from the latest checkpoint.
   */
  async checkpoint(name?: string): Promise<void> {
    const snap = await this._deps.control.createSnapshot(this.sandboxId);
    await this._waitForSnapshot(snap.id);
    await this._emit(LedgerEvent.CheckpointCreated, -1, { snapshotId: snap.id, name });
    this._deps.hooks?.onCheckpoint?.(this.sandboxId, snap.id, name);
  }

  private async _waitForSnapshot(snapshotId: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snap = await this._deps.control.getSnapshot(snapshotId);
      if (snap.state === SnapshotState.Ready) return;
      if (snap.state === SnapshotState.Failed) {
        throw new SandboxError(`Snapshot ${snapshotId} failed`, this.sandboxId);
      }
      await new Promise<void>((r) => setTimeout(r, 2_000));
    }
    throw new SandboxError(`Snapshot ${snapshotId} did not become ready within ${timeoutMs}ms`, this.sandboxId);
  }

  /**
   * Delete the sandbox container and release its resources.
   *
   * Always call `close()` when done — even on error — to avoid leaking containers.
   * Idempotent: subsequent calls are no-ops.
   */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    try {
      await this._deps.control.deleteSandbox(this.sandboxId);
    } finally {
      await this._emit(LedgerEvent.SandboxClosed, -1);
      this._deps.hooks?.onSandboxClosed?.(this.sandboxId);
      this._deps.onClose?.();
    }
  }
}
