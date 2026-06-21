
/** Events emitted during workflow execution and stored in the ledger. */
export enum LedgerEvent {
  /** Emitted once when a workflow run starts, before any steps execute. */
  RunStarted = "run_started",
  /** Emitted at the beginning of each step. */
  StepStart = "step_start",
  /** Emitted when a step finishes successfully. */
  StepComplete = "step_complete",
  /** Emitted when a step throws an unrecoverable error. */
  StepFailed = "step_failed",
  /** Emitted when a step's rollback handler completes during saga compensation. */
  StepRolledBack = "step_rolled_back",
  /** Emitted after all steps finish without error. */
  WorkflowComplete = "workflow_complete",
  /** Emitted after rollback completes following a step failure. */
  WorkflowFailed = "workflow_failed",
  /** Durable resumption point written after each successful step. */
  Checkpoint = "checkpoint",
  /** Streaming output chunk from `exec()` or `execCode()`. */
  ExecEvent = "exec_event",
  /** Emitted when a sandbox snapshot is captured mid-run. */
  Snapshot = "snapshot",
}

/** A single event record written to the storage adapter during a workflow run. */
export interface LedgerEntry {
  /** Unix timestamp in milliseconds. */
  ts: number;
  workflowName: string;
  runId: string;
  /** Zero-based index of the step that produced this event. `-1` for run-level events. */
  stepIndex: number;
  /** Parallel branch index, when this step is inside a `parallel()` block. */
  branch?: number;
  event: LedgerEvent;
  /** Event-specific data (step output, snapshot ID, exec text, etc.). */
  payload?: unknown;
  /** Error message when `event` is `StepFailed` or `WorkflowFailed`. */
  error?: string;
}

/**
 * Persistence interface for workflow event storage.
 *
 * Implement this interface to plug in any storage backend. drej ships two
 * official implementations: `@drej/sqlite` (local dev, zero infra) and
 * `@drej/postgres` (production).
 *
 * @example
 * ```ts
 * import { SQLiteAdapter } from "@drej/sqlite";
 * const client = new DrejClient({ baseUrl, adapter: new SQLiteAdapter("./drej.db") });
 * await client.connect();
 * ```
 */
export interface IStorageAdapter {
  /** Run migrations / open connections. Must be called before first use. */
  connect?(): Promise<void>;
  /** Release connections and resources. Call on graceful shutdown. */
  close?(): Promise<void>;
  /** Persist a single ledger event. Called automatically during workflow execution. */
  append(entry: LedgerEntry): Promise<void>;
  /** Return all events for a specific run, in ascending timestamp order. */
  readAll(workflowName: string, runId: string): Promise<LedgerEntry[]>;
  /** Return the most recent checkpoint entry for a run, or `null` if none exists. */
  lastCheckpoint(workflowName: string, runId: string): Promise<LedgerEntry | null>;
  /** Return all run IDs recorded under a workflow name. */
  listRuns(workflowName: string): Promise<string[]>;
}
