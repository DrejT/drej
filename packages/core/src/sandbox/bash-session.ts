import type { ExecHandle } from "../exec-handle";

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
