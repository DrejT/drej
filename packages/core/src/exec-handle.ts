import { SSEEventType } from "@drej/opensandbox";
import type { SSEEvent } from "@drej/opensandbox";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

type ExecDriver =
  | { type: "stream"; gen: AsyncGenerator<SSEEvent>; onDone: (r: ExecResult) => Promise<void> }
  | { type: "replay"; result: ExecResult };

/**
 * Returned by `Sandbox.exec()` and `Sandbox.execCode()`.
 *
 * Implements `PromiseLike<ExecResult>` so `await sb.exec(...)` works naturally.
 * Also exposes `pipe()`, `stdout()`, and `result()` for streaming output.
 *
 * @example
 * ```ts
 * // simple await
 * const { exitCode } = await sb.exec("npm test");
 *
 * // stream to stdout
 * await sb.exec("npm run build").pipe(process.stdout);
 *
 * // async generator
 * for await (const chunk of sb.exec("npm test").stdout()) process.stdout.write(chunk);
 * ```
 */
export class ExecHandle implements PromiseLike<ExecResult> {
  private readonly _promise: Promise<ExecResult>;
  private readonly _chunks: string[] = [];
  private _wakeup: (() => void) | null = null;
  private _done = false;
  private _err: unknown;
  private _hasErr = false;

  constructor(driver: ExecDriver) {
    if (driver.type === "replay") {
      if (driver.result.stdout) this._chunks.push(driver.result.stdout);
      this._done = true;
      this._promise = Promise.resolve(driver.result);
    } else {
      this._promise = this._drain(driver.gen, driver.onDone);
      this._promise.catch(() => {});
    }
  }

  private async _drain(
    gen: AsyncGenerator<SSEEvent>,
    onDone: (r: ExecResult) => Promise<void>,
  ): Promise<ExecResult> {
    const stderr: string[] = [];
    let exitCode = 0;
    try {
      for await (const ev of gen) {
        if (ev.type === SSEEventType.Stdout && ev.text) {
          this._chunks.push(ev.text);
          this._notify();
        }
        if (ev.type === SSEEventType.Stderr && ev.text) {
          stderr.push(ev.text);
        }
        if (ev.type === SSEEventType.Error && ev.error?.evalue !== undefined) {
          const code = Number(ev.error.evalue);
          if (!isNaN(code)) exitCode = code;
        }
      }
    } catch (err) {
      this._err = err;
      this._hasErr = true;
      throw err;
    } finally {
      this._done = true;
      this._notify();
    }

    const result: ExecResult = {
      stdout: this._chunks.join(""),
      stderr: stderr.join(""),
      exitCode,
    };
    await onDone(result);
    return result;
  }

  private _notify(): void {
    const fn = this._wakeup;
    this._wakeup = null;
    fn?.();
  }

  then<T, E>(
    onfulfilled?: ((value: ExecResult) => T | PromiseLike<T>) | null,
    onrejected?: ((reason: unknown) => E | PromiseLike<E>) | null,
  ): Promise<T | E> {
    return this._promise.then(onfulfilled, onrejected) as Promise<T | E>;
  }

  /** Resolve the full result: `{ stdout, stderr, exitCode }`. */
  result(): Promise<ExecResult> {
    return this._promise;
  }

  /** Async generator yielding stdout chunks as they arrive. */
  async *stdout(): AsyncGenerator<string> {
    let pos = 0;
    while (true) {
      while (pos < this._chunks.length) yield this._chunks[pos++];
      if (this._done) break;
      await new Promise<void>((r) => {
        this._wakeup = r;
      });
    }
    while (pos < this._chunks.length) yield this._chunks[pos++];
    if (this._hasErr) throw this._err;
  }

  /** Pipe stdout to any writable with a `write(chunk: string)` method. */
  async pipe(writable: { write(chunk: string): unknown }): Promise<void> {
    for await (const chunk of this.stdout()) writable.write(chunk);
  }
}
