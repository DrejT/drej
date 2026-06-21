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

/** Options for constructing a {@link DrejClient}. */
export interface DrejClientOptions {
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

/** Options passed to {@link DrejClient.run}. */
export interface RunOptions {
  /** Capture a sandbox snapshot after specific step indices complete. */
  snapshotConfig?: SnapshotConfig;
  /** Lifecycle hooks for observability (e.g. pass `otelHooks(tracer)` from `@drej/otel`). */
  hooks?: WorkflowHooks;
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
 * @example
 * ```ts
 * const run = await client.run(workflow("build").sandbox(...));
 * console.log(run.id); // UUID for this run
 * for await (const ev of run) {
 *   if (ev.event === LedgerEvent.ExecEvent) process.stdout.write(ev.payload.text);
 * }
 * ```
 */
export class WorkflowRun implements AsyncIterable<WorkflowEvent> {
  private _status: RunStatus = RunStatus.Running;

  /** Current execution status. Updates as events are consumed via `for await`. */
  get status(): RunStatus { return this._status; }

  constructor(
    /** The workflow name passed to `workflow(name)`. */
    public readonly name: string,
    /** UUID identifying this specific execution. */
    public readonly id: string,
    private readonly _events: AsyncGenerator<WorkflowEvent>,
  ) {}

  [Symbol.asyncIterator](): AsyncIterator<WorkflowEvent> {
    const self = this;
    const gen = this._events;
    return {
      async next() {
        try {
          const r = await gen.next();
          if (r.done) self._status = RunStatus.Completed;
          return r;
        } catch (e) {
          self._status = RunStatus.Failed;
          throw e;
        }
      },
      return(v) {
        self._status = RunStatus.Cancelled;
        return gen.return?.(v) ?? Promise.resolve({ done: true as const, value: v as WorkflowEvent });
      },
    };
  }
}
