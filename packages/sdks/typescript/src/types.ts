import type { IStorageAdapter, SnapshotConfig, WorkflowHooks } from "@drej/core";
import { RunStatus } from "@drej/core";
import type { LedgerEntry } from "@drej/core";

export { RunStatus };

/** Thrown when an OpenSandbox API call returns a non-2xx response. */
export class DrejError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DrejError";
  }
}

/** Options for constructing a {@link Drej} client. */
export interface DrejOptions {
  /** Base URL of your OpenSandbox server (e.g. `http://localhost:8080`). */
  baseUrl: string;
  /** OpenSandbox API key. Pass an empty string for local dev with no auth. */
  apiKey?: string;
  /**
   * Storage adapter for persisting workflow events.
   *
   * Pass `new SQLiteAdapter("./drej.db")` from `@drej/sqlite` for local use, or
   * `new PostgresAdapter(connectionString)` from `@drej/postgres` for production.
   * You can also supply any custom `IStorageAdapter` implementation.
   */
  adapter: IStorageAdapter;
  /**
   * Maximum number of workflow runs that may execute simultaneously.
   * When at capacity, `run()` awaits until a slot is free before starting.
   * Omit or set to `undefined` for no limit.
   */
  maxConcurrency?: number;
}

/** Options passed to {@link Drej.run}. */
export interface RunOptions {
  /** Capture a sandbox snapshot after specific step indices complete. */
  snapshotConfig?: SnapshotConfig;
  /** Lifecycle hooks for observability (e.g. pass `otelHooks(tracer)` from `@drej/otel`). */
  hooks?: WorkflowHooks;
  /**
   * Default timeout in milliseconds for every step that does not set its own
   * `timeoutMs`. When a step exceeds this limit the run fails with
   * `StepTimeoutError` and rollback runs automatically.
   */
  stepTimeoutMs?: number;
  /**
   * An `AbortSignal` to cancel the run from outside. When the signal fires,
   * the current in-flight step is aborted and rollback runs automatically.
   * Compose with `AbortController` or `AbortSignal.timeout()`.
   */
  signal?: AbortSignal;
}

/**
 * A single event emitted and persisted during a workflow run.
 * The shape is identical to `LedgerEntry` — every event stored in the adapter
 * is also yielded to the caller in real-time.
 */
export type WorkflowEvent = LedgerEntry;

/**
 * An active or completed workflow execution. Implements `AsyncIterable<WorkflowEvent>`
 * so you can stream events as they happen with `for await`.
 *
 * Call `run.cancel()` to abort the in-flight step and stop the loop cleanly —
 * no error is thrown and `run.status` becomes `"cancelled"`. Breaking out of
 * the `for await` loop has the same effect.
 *
 * @example
 * ```ts
 * const run = await client.run(workflow("build").sandbox(...));
 *
 * // stream stdout only
 * for await (const text of run.stdout()) process.stdout.write(text);
 *
 * // or drain everything and get the final captured state
 * const { output, state } = await run.result();
 *
 * // or pipe to any writable
 * await run.pipe(process.stdout);
 * ```
 */
export class WorkflowRun implements AsyncIterable<WorkflowEvent> {
  private _status: RunStatus = RunStatus.Running;
  private readonly _cancelFn: () => void;

  /** Current execution status. Updates as events are consumed via `for await`. */
  get status(): RunStatus { return this._status; }

  constructor(
    /** The workflow name passed to `workflow(name)`. */
    public readonly name: string,
    /** UUID identifying this specific execution. */
    public readonly id: string,
    private readonly _events: AsyncGenerator<WorkflowEvent>,
    /** Internal abort callback wired to the workflow's AbortController. */
    cancelFn?: () => void,
  ) {
    this._cancelFn = cancelFn ?? (() => {});
  }

  /**
   * Abort the run immediately. The current in-flight step is cancelled,
   * rollback runs, and `run.status` becomes `Cancelled`.
   *
   * Equivalent to breaking out of the `for await` loop.
   */
  cancel(): void {
    this._status = RunStatus.Cancelled;
    this._cancelFn();
  }

  /**
   * Async generator that yields each stdout/stderr text chunk as it arrives.
   * Filters the raw event stream to `exec_event` payloads only.
   *
   * @example
   * ```ts
   * for await (const text of run.stdout()) process.stdout.write(text);
   * ```
   */
  async *stdout(): AsyncGenerator<string> {
    for await (const ev of this) {
      if (ev.event === "exec_event") {
        const { text } = ev.payload as { text?: string };
        if (text) yield text;
      }
    }
  }

  /**
   * Drain the run to completion and return the concatenated stdout and the
   * final workflow state (captured `Ref` values, keyed by their auto-generated key).
   *
   * @example
   * ```ts
   * const { output, state } = await run.result();
   * console.log(output);           // all stdout
   * console.log(state[versionRef.key]); // captured ref value
   * ```
   */
  async result(): Promise<{ output: string; state: Record<string, unknown> }> {
    let output = "";
    let state: Record<string, unknown> = {};
    for await (const ev of this) {
      if (ev.event === "exec_event") {
        const { text } = ev.payload as { text?: string };
        if (text) output += text;
      } else if (ev.event === "step_complete") {
        state = ev.payload as Record<string, unknown>;
      }
    }
    return { output, state };
  }

  /**
   * Pipe stdout to any object with a `write(chunk: string)` method, such as
   * `process.stdout`. Resolves when the run completes.
   *
   * @example
   * ```ts
   * await run.pipe(process.stdout);
   * ```
   */
  async pipe(writable: { write(chunk: string): unknown }): Promise<void> {
    for await (const text of this.stdout()) writable.write(text);
  }

  [Symbol.asyncIterator](): AsyncIterator<WorkflowEvent> {
    const self = this;
    const gen = this._events;
    return {
      async next() {
        try {
          const r = await gen.next();
          if (r.done && self._status === RunStatus.Running) self._status = RunStatus.Completed;
          return r;
        } catch (e) {
          if (self._status === RunStatus.Cancelled) {
            // run.cancel() was called — end the loop cleanly, no error thrown
            return { done: true as const, value: undefined as unknown as WorkflowEvent };
          }
          self._status = RunStatus.Failed;
          throw e;
        }
      },
      return(v) {
        self._status = RunStatus.Cancelled;
        self._cancelFn();
        return gen.return?.(v) ?? Promise.resolve({ done: true as const, value: v as WorkflowEvent });
      },
    };
  }
}
