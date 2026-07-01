import { ExecClient, SnapshotState, SandboxState } from "@drej/opensandbox";
import type {
  ControlClient,
  SSEEvent,
  DiagnosticLog,
  DiagnosticEvent,
  Metrics,
  RunInSessionRequest,
} from "@drej/opensandbox";
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
  onSandboxPaused?(sandboxId: string): void;
  onSandboxResumed?(sandboxId: string): void;
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
  private _paused = false;
  private readonly _openSessionClosers = new Set<() => Promise<void>>();

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
    if (this._paused)
      throw new SandboxError("sandbox is paused — call resume() first", this.sandboxId);
    if (!this._execClient) {
      this._execClient = await resolveExecClient(
        this._deps.control,
        this.sandboxId,
        this._deps.useServerProxy,
      );
    }
    return this._execClient;
  }

  private async _waitForRunning(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = await this._deps.control.getSandbox(this.sandboxId);
      if (s.status.state === SandboxState.Running) return;
      if (s.status.state === SandboxState.Failed || s.status.state === SandboxState.Terminated) {
        throw new SandboxError(
          `Sandbox entered ${s.status.state}: ${s.status.message ?? ""}`,
          this.sandboxId,
        );
      }
      await new Promise<void>((r) => setTimeout(r, 1_000));
    }
    throw new SandboxError(`Sandbox did not reach Running within ${timeoutMs}ms`, this.sandboxId);
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
      for await (const ev of execClient.executeCommand({
        command,
        cwd: opts.cwd,
        envs: opts.env,
        timeout: opts.timeoutMs,
      })) {
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
  async createCodeContext(
    language: import("@drej/opensandbox").CodeLanguage,
  ): Promise<import("@drej/opensandbox").CodeContext> {
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
  async replaceInFiles(
    replacements: Array<{ path: string; old: string; new: string }>,
  ): Promise<void> {
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
    const ep = await this._deps.control.getEndpoint(
      this.sandboxId,
      port,
      this._deps.useServerProxy,
    );
    const url = ep.endpoint.startsWith("http") ? ep.endpoint : `http://${ep.endpoint}`;
    return { url, headers: ep.headers ?? {} };
  }

  /** Return current CPU and memory usage for this sandbox. */
  async metrics(): Promise<Metrics> {
    const ec = await this._getExecClient();
    return ec.getMetrics();
  }

  /**
   * Stream real-time CPU and memory metrics from execd via SSE.
   *
   * Holds a long-lived connection — break out of the loop or pass an AbortSignal
   * when done to avoid leaking the connection.
   *
   * @example
   * ```ts
   * for await (const m of sb.watchMetrics()) {
   *   console.log(m.cpu, m.memory);
   *   if (m.cpu > 0.9) break;
   * }
   * ```
   */
  async *watchMetrics(): AsyncGenerator<Metrics> {
    const ec = await this._getExecClient();
    for await (const ev of ec.watchMetrics()) {
      const m = ev as unknown as Metrics;
      if (typeof m.cpu === "number" && typeof m.memory === "number") yield m;
    }
  }

  /** Return sandbox diagnostic logs (names, sizes, and optional inline content). */
  async diagnosticLogs(): Promise<DiagnosticLog[]> {
    return this._deps.control.getDiagnosticLogs(this.sandboxId);
  }

  /** Return sandbox diagnostic events (timestamps, types, and messages). */
  async diagnosticEvents(): Promise<DiagnosticEvent[]> {
    return this._deps.control.getDiagnosticEvents(this.sandboxId);
  }

  /**
   * Freeze the sandbox container. Releases compute on Kubernetes; on Docker it
   * is a cgroup freeze that preserves in-memory state.
   *
   * All pending exec calls will throw `SandboxError` until `resume()` is called.
   * `close()` remains valid on a paused sandbox.
   */
  async pause(): Promise<void> {
    await this._deps.control.pauseSandbox(this.sandboxId);
    this._paused = true;
    this._execClient = null;
    await this._emit(LedgerEvent.SandboxPaused, -1);
    this._deps.hooks?.onSandboxPaused?.(this.sandboxId);
  }

  /**
   * Restore a paused sandbox to Running state and re-resolve the execd endpoint.
   *
   * On Docker, this unfreezes the container instantly. On Kubernetes, a new pod
   * is created from the OCI snapshot — in-memory process state is not preserved.
   * Polls until the sandbox reports Running before returning.
   */
  async resume(): Promise<void> {
    await this._deps.control.resumeSandbox(this.sandboxId);
    this._paused = false;
    await this._waitForRunning();
    await this._emit(LedgerEvent.SandboxResumed, -1);
    this._deps.hooks?.onSandboxResumed?.(this.sandboxId);
  }

  /**
   * Create a persistent bash session that preserves CWD and env vars across
   * multiple `exec()` calls.
   *
   * Always call `session.close()` when done, or the shell process leaks inside
   * the container. `sandbox.close()` also closes all open sessions automatically.
   *
   * @example
   * ```ts
   * const session = await sb.createSession({ cwd: "/app" });
   * try {
   *   await session.exec("export DB_URL=postgres://localhost/mydb");
   *   await session.exec("npm run migrate").pipe(process.stdout);
   *   await session.exec("npm test").pipe(process.stdout);
   * } finally {
   *   await session.close();
   * }
   * ```
   */
  async createSession(opts?: { cwd?: string }): Promise<BashSession> {
    const ec = await this._getExecClient();
    const resp = await ec.createSession(opts);
    const sessionId = resp.session_id;

    const self = this;

    const execInSession = (
      command: string,
      cmdOpts?: { cwd?: string; timeoutMs?: number },
    ): ExecHandle => {
      const seq = ++self._seq;
      async function* stream(): AsyncGenerator<SSEEvent> {
        await self._emit(LedgerEvent.ExecStart, seq, { cmd: command, seq, sessionId });
        self._deps.hooks?.onExecStart?.(self.sandboxId, seq, command);
        for await (const ev of ec.runInSession(sessionId, {
          command,
          cwd: cmdOpts?.cwd,
          timeout: cmdOpts?.timeoutMs,
        } as RunInSessionRequest)) {
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
          if (result.exitCode !== 0)
            throw new CommandError(result.exitCode, command, self.sandboxId);
        },
      });
    };

    const closeSession = async (): Promise<void> => {
      self._openSessionClosers.delete(closeSession);
      await ec.deleteSession(sessionId);
    };

    this._openSessionClosers.add(closeSession);
    return new BashSession(sessionId, execInSession, closeSession);
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
    if (!this._deps.fork)
      throw new SandboxError("fork() is not supported on this sandbox", this.sandboxId);
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
    throw new SandboxError(
      `Snapshot ${snapshotId} did not become ready within ${timeoutMs}ms`,
      this.sandboxId,
    );
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
    // Close open bash sessions (best-effort — container is being deleted anyway).
    await Promise.allSettled([...this._openSessionClosers].map((fn) => fn()));
    this._openSessionClosers.clear();
    try {
      await this._deps.control.deleteSandbox(this.sandboxId);
    } finally {
      await this._emit(LedgerEvent.SandboxClosed, -1);
      this._deps.hooks?.onSandboxClosed?.(this.sandboxId);
      this._deps.onClose?.();
    }
  }
}

/**
 * A persistent bash session inside a sandbox. CWD and env vars are preserved
 * across `exec()` calls, unlike the stateless `sandbox.exec()`.
 *
 * Create with `sandbox.createSession()`. Always call `close()` when done.
 */
export class BashSession {
  /** execd session ID. */
  readonly sessionId: string;
  private readonly _execFn: (
    command: string,
    opts?: { cwd?: string; timeoutMs?: number },
  ) => ExecHandle;
  private readonly _closeFn: () => Promise<void>;
  private _closed = false;

  constructor(
    sessionId: string,
    execFn: (command: string, opts?: { cwd?: string; timeoutMs?: number }) => ExecHandle,
    closeFn: () => Promise<void>,
  ) {
    this.sessionId = sessionId;
    this._execFn = execFn;
    this._closeFn = closeFn;
  }

  /**
   * Run a command in this session. Shell state (CWD, exported env vars) persists
   * between calls.
   *
   * @example
   * ```ts
   * await session.exec("cd /app && export NODE_ENV=test");
   * const { stdout } = await session.exec("node -e 'console.log(process.env.NODE_ENV)'");
   * // stdout === "test\n"
   * ```
   */
  exec(command: string, opts?: { cwd?: string; timeoutMs?: number }): ExecHandle {
    return this._execFn(command, opts);
  }

  /** Terminate the shell process and release resources. */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    await this._closeFn();
  }
}
