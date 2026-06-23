/** Status of a sandbox session derived from its ledger events. */
export enum SandboxStatus {
  Running   = "running",
  Completed = "completed",
  Failed    = "failed",
  Cancelled = "cancelled",
}

/** Derived metadata for a sandbox session, computed from its ledger events. */
export interface SandboxDetails {
  /** User-provided name (or auto-generated). */
  name: string;
  sandboxId: string;
  status: SandboxStatus;
  /** Unix timestamp (ms) of the `sandbox_created` event. */
  startedAt: number;
  /** Unix timestamp (ms) of the `sandbox_closed` event, if the session has ended. */
  completedAt?: number;
  /** Number of exec() calls that completed. */
  execCount: number;
  /** Error message, present when status is `Failed`. */
  error?: string;
}

/** Options for filtering session listings. */
export interface ListSandboxOptions {
  status?: SandboxStatus;
  /** Max number of results to return. */
  limit?: number;
  /** Return only sessions that started before this Unix timestamp (ms). */
  before?: number;
}

/** Events emitted during execution and stored in the ledger. */
export enum LedgerEvent {
  // ── Sandbox substrate events ──────────────────────────────────────────────
  /** Emitted when a sandbox is created and reaches Running state. */
  SandboxCreated = "sandbox_created",
  /** Emitted at the start of each exec() or execCode() call. */
  ExecStart = "exec_start",
  /** Streaming output chunk from exec() or execCode(). */
  ExecEvent = "exec_event",
  /** Emitted when an exec() or execCode() call completes. */
  ExecComplete = "exec_complete",
  /** Emitted when checkpoint() captures a snapshot. */
  CheckpointCreated = "checkpoint_created",
  /** Emitted when a sandbox is closed. */
  SandboxClosed = "sandbox_closed",

  // ── Workflow layer events (used by @drej/workflow) ────────────────────────
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
  /** Emitted when a sandbox snapshot is captured mid-run. */
  Snapshot = "snapshot",
}

/** A single event record written to the storage adapter during a session. */
export interface LedgerEntry {
  /** Unix timestamp in milliseconds. */
  ts: number;
  /** Sandbox session name. */
  name: string;
  sandboxId: string;
  /** Zero-based index of the step that produced this event. `-1` for session-level events. */
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
 * Persistence interface for session event storage.
 *
 * Implement this interface to plug in any storage backend. drej ships two
 * official implementations: `@drej/sqlite` (local dev, zero infra) and
 * `@drej/postgres` (production).
 *
 * @example
 * ```ts
 * import { SQLiteAdapter } from "@drej/sqlite";
 * const client = new Drej({ baseUrl, adapter: new SQLiteAdapter("./drej.db") });
 * await client.connect();
 * ```
 */
export interface IStorageAdapter {
  /** Run migrations / open connections. Must be called before first use. */
  connect?(): Promise<void>;
  /** Release connections and resources. Call on graceful shutdown. */
  close?(): Promise<void>;
  /** Persist a single ledger event. Called automatically during execution. */
  append(entry: LedgerEntry): Promise<void>;
  /** Return all events for a specific session, in ascending timestamp order. */
  readAll(name: string, sandboxId: string): Promise<LedgerEntry[]>;
  /** Return the most recent checkpoint entry for a session, or `null` if none exists. */
  lastCheckpoint(name: string, sandboxId: string): Promise<LedgerEntry | null>;
  /** Return details for all sessions with a given name, newest first. */
  listSandboxDetails(name: string, opts?: ListSandboxOptions): Promise<SandboxDetails[]>;
  /** Return details for sessions across all names, newest first. */
  listAllSandboxDetails(opts?: ListSandboxOptions): Promise<SandboxDetails[]>;
  /** Return details for a single session, or `null` if not found. */
  getSandboxDetails(name: string, sandboxId: string): Promise<SandboxDetails | null>;
  /** Delete all ledger events for a session. */
  deleteSandbox(name: string, sandboxId: string): Promise<void>;
}
