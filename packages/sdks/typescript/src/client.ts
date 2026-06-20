import {
  Workflow,
  LedgerEvent,
  buildStep,
  resolveExecClient,
  shouldSnapshot,
  waitForSnapshot,
  type WorkflowDeps,
  type IStorageAdapter,
  type LedgerEntry,
  type SnapshotConfig,
  type StepDef,
} from "@drejt/core";
import {
  ControlClient,
  type Sandbox,
  type SandboxState,
  type CreateSandboxOptions,
  type ListSandboxesOptions,
  type Snapshot,
  type ListSnapshotsOptions,
  type DiagnosticLog,
  type DiagnosticEvent,
} from "@drejt/opensandbox";
import type { WorkflowBuilder } from "./workflow";

export { LedgerEvent };
export type { LedgerEntry, SnapshotConfig, StepDef, IStorageAdapter };
export type {
  Sandbox,
  SandboxState,
  CreateSandboxOptions,
  ListSandboxesOptions,
  Snapshot,
  ListSnapshotsOptions,
  DiagnosticLog,
  DiagnosticEvent,
} from "@drejt/opensandbox";
export type { SandboxStatus, SnapshotState, Resources, ImageSpec, ImageAuth } from "@drejt/opensandbox";

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
   * Pass `new SQLiteAdapter("./drej.db")` from `@drejt/sqlite` for local use, or
   * `new PostgresAdapter(connectionString)` from `@drejt/postgres` for production.
   * You can also supply any custom `IStorageAdapter` implementation.
   */
  adapter: IStorageAdapter;
}

/** Options passed to {@link DrejClient.run}. */
export interface RunOptions {
  /** Capture a sandbox snapshot after specific step indices complete. */
  snapshotConfig?: SnapshotConfig;
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
  constructor(
    /** The workflow name passed to `workflow(name)`. */
    public readonly name: string,
    /** UUID identifying this specific execution. */
    public readonly id: string,
    private readonly _events: AsyncGenerator<WorkflowEvent>,
  ) {}

  [Symbol.asyncIterator](): AsyncIterator<WorkflowEvent> {
    return this._events;
  }
}

/**
 * Main entry point for drej. Manages workflow execution, sandbox lifecycle,
 * snapshots, and run history.
 *
 * @example
 * ```ts
 * import { DrejClient, workflow } from "drej";
 * import { SQLiteAdapter } from "@drejt/sqlite";
 *
 * const client = new DrejClient({
 *   baseUrl: "http://localhost:8080",
 *   adapter: new SQLiteAdapter("./drej.db"),
 * });
 * await client.connect();
 *
 * const run = await client.run(
 *   workflow("hello").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
 *     s.exec("node -e 'console.log(\"hello\")'"),
 *   ),
 * );
 * for await (const ev of run) { ... }
 *
 * await client.close();
 * ```
 */
export class DrejClient {
  private readonly control: ControlClient;
  private readonly adapter: IStorageAdapter;

  constructor(options: DrejClientOptions) {
    this.control = new ControlClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey ?? "",
    });
    this.adapter = options.adapter;
  }

  /**
   * Initializes the storage adapter (runs migrations, opens connection pools).
   * Must be called before the first `run()` when using a DB-backed adapter.
   */
  async connect(): Promise<void> {
    await this.adapter.connect?.();
  }

  /**
   * Releases storage adapter resources (closes DB connection pools, etc.).
   * Call this on graceful shutdown to avoid dangling connections.
   */
  async close(): Promise<void> {
    await this.adapter.close?.();
  }

  // ── Sandbox management ────────────────────────────────────────────────────

  /** Create a new sandbox. Prefer using `workflow().sandbox()` for managed lifecycle. */
  createSandbox(options: CreateSandboxOptions): Promise<Sandbox> {
    return this.control.createSandbox(options);
  }

  /** List sandboxes, optionally filtered by state or metadata. */
  listSandboxes(options: ListSandboxesOptions = {}): Promise<Sandbox[]> {
    return this.control.listSandboxes(options);
  }

  /** Fetch a sandbox by ID. */
  getSandbox(id: string): Promise<Sandbox> {
    return this.control.getSandbox(id);
  }

  /** Permanently delete a sandbox and release its resources. */
  deleteSandbox(id: string): Promise<void> {
    return this.control.deleteSandbox(id);
  }

  /** Pause a running sandbox (suspends billing while preserving state). */
  pauseSandbox(id: string): Promise<void> {
    return this.control.pauseSandbox(id);
  }

  /** Resume a paused sandbox. */
  resumeSandbox(id: string): Promise<void> {
    return this.control.resumeSandbox(id);
  }

  /** Extend the sandbox expiration timer. */
  renewSandbox(id: string): Promise<void> {
    return this.control.renewExpiration(id);
  }

  /**
   * Poll until the sandbox reaches `Running` state.
   * Throws {@link DrejError} if the sandbox fails, terminates, or the timeout elapses.
   */
  async waitForRunning(
    id: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<Sandbox> {
    const { timeoutMs = 60_000, pollIntervalMs = 1_000 } = options;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const sandbox = await this.control.getSandbox(id);
      const { state } = sandbox.status;
      if (state === "Running") return sandbox;
      if (state === "Failed" || state === "Terminated") {
        throw new DrejError(`Sandbox ${id} entered state ${state}`, 500);
      }
      await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
    }
    throw new DrejError(`Sandbox ${id} did not reach Running within ${timeoutMs}ms`, 408);
  }

  // ── Snapshot management ───────────────────────────────────────────────────

  /** Capture a snapshot of a running sandbox. The sandbox must be in `Running` state. */
  createSnapshot(sandboxId: string): Promise<Snapshot> {
    return this.control.createSnapshot(sandboxId);
  }

  /** List all snapshots, optionally filtered. */
  listSnapshots(options: ListSnapshotsOptions = {}): Promise<Snapshot[]> {
    return this.control.listSnapshots(options);
  }

  /** Fetch a snapshot by ID. */
  getSnapshot(id: string): Promise<Snapshot> {
    return this.control.getSnapshot(id);
  }

  /** Delete a snapshot. */
  deleteSnapshot(id: string): Promise<void> {
    return this.control.deleteSnapshot(id);
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  /** Fetch structured log lines from a sandbox (stdout/stderr). */
  getDiagnosticLogs(sandboxId: string): Promise<DiagnosticLog[]> {
    return this.control.getDiagnosticLogs(sandboxId);
  }

  /** Fetch sandbox lifecycle events (start, stop, OOM, etc.). */
  getDiagnosticEvents(sandboxId: string): Promise<DiagnosticEvent[]> {
    return this.control.getDiagnosticEvents(sandboxId);
  }

  // ── Workflow execution ────────────────────────────────────────────────────

  /**
   * Execute a workflow and return a {@link WorkflowRun} you can iterate over.
   *
   * Events are streamed in real-time as steps complete. Every event is also
   * written to the storage adapter so runs are resumable.
   *
   * @example
   * ```ts
   * const run = await client.run(
   *   workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
   *     s.exec("npm ci").exec("npm test"),
   *   ),
   * );
   * for await (const ev of run) {
   *   if (ev.event === LedgerEvent.ExecEvent) process.stdout.write(ev.payload.text);
   * }
   * ```
   */
  async run(
    w: WorkflowBuilder,
    options?: RunOptions,
  ): Promise<WorkflowRun> {
    const { name, steps } = w.build();
    const runId = crypto.randomUUID();
    return new WorkflowRun(name, runId, this._execute(name, runId, steps, options));
  }

  /**
   * Re-run a workflow starting from a previously captured sandbox snapshot.
   * The new run boots from the snapshot image, skipping any steps that ran
   * before the snapshot was taken (e.g. dependency installs).
   *
   * The original run must have been executed with `snapshotConfig` set so
   * that a `LedgerEvent.Snapshot` entry exists in the ledger.
   */
  async replayFromSnapshot(
    name: string,
    runId: string,
    w: WorkflowBuilder,
  ): Promise<WorkflowRun> {
    const entries = await this.adapter.readAll(name, runId);
    const snapEntry = [...entries].reverse().find((e) => e.event === LedgerEvent.Snapshot);
    if (!snapEntry) throw new DrejError(`No snapshot found in ledger for ${name}/${runId}`, 404);
    const { snapshotId } = snapEntry.payload as { snapshotId: string };

    const { name: wfName, steps } = w.build();
    const replaySteps: StepDef[] = steps.map((s) =>
      s.type === "create_sandbox" ? { ...s, snapshotId } : s,
    );
    const replayRunId = crypto.randomUUID();
    return new WorkflowRun(wfName, replayRunId, this._execute(wfName, replayRunId, replaySteps));
  }

  /**
   * Resume an interrupted workflow run from its last checkpoint.
   *
   * Reads the ledger to find the furthest completed step, then re-runs
   * the workflow starting from the next step. Steps that already completed
   * are not re-executed.
   */
  async resumeRun(name: string, runId: string, w: WorkflowBuilder): Promise<WorkflowRun> {
    const { steps } = w.build();
    const workflowSteps = steps.map(buildStep);

    const stream = this._makeStream(name, runId, async (teeDeps) => {
      const { workflow, nextStep, lastOutput } = await Workflow.resumeFromLedger(
        name,
        runId,
        workflowSteps,
        teeDeps,
      );
      try {
        await workflow.run(lastOutput, nextStep);
      } catch {
        try { await workflow.rollback(); } catch { /* ignore */ }
      }
    });

    return new WorkflowRun(name, runId, stream);
  }

  // ── Adapter access ────────────────────────────────────────────────────────

  /** Return all run IDs recorded under a workflow name. */
  listRuns(workflowName: string): Promise<string[]> {
    return this.adapter.listRuns(workflowName);
  }

  /** Return all ledger events for a specific run, in ascending order. */
  getRunLedger(workflowName: string, runId: string): Promise<WorkflowEvent[]> {
    return this.adapter.readAll(workflowName, runId) as Promise<WorkflowEvent[]>;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _execute(
    name: string,
    runId: string,
    steps: StepDef[],
    options?: RunOptions,
  ): AsyncGenerator<WorkflowEvent> {
    return this._makeStream(name, runId, async (teeDeps) => {
      const snapshotHook: WorkflowDeps["hooks"] = options?.snapshotConfig
        ? {
            async onStepComplete({ workflowName: wfName, runId: rid, stepIndex, output }) {
              if (!shouldSnapshot(options.snapshotConfig!, stepIndex)) return;
              const sandboxId = (output as Record<string, unknown>)?.sandboxId;
              if (typeof sandboxId !== "string") return;
              const snap = await teeDeps.control.createSnapshot(sandboxId);
              await waitForSnapshot(teeDeps.control, snap.id);
              await teeDeps.adapter.append({
                ts: Date.now(),
                workflowName: wfName,
                runId: rid,
                stepIndex,
                event: LedgerEvent.Snapshot,
                payload: { snapshotId: snap.id, sandboxId },
              });
            },
          }
        : undefined;

      const deps: WorkflowDeps = { ...teeDeps, hooks: snapshotHook };
      const wf = new Workflow(name, runId, steps.map(buildStep), deps);
      try {
        await wf.run({});
      } catch {
        try { await wf.rollback(); } catch { /* ignore */ }
      }
    });
  }

  // Runs `execute` in the background and returns an async generator that
  // yields WorkflowEvents in real-time as they are appended to the adapter.
  private _makeStream(
    name: string,
    runId: string,
    execute: (deps: WorkflowDeps) => Promise<void>,
  ): AsyncGenerator<WorkflowEvent> {
    const queue: WorkflowEvent[] = [];
    let wakeup: (() => void) | null = null;
    let done = false;

    const enqueue = (entry: LedgerEntry) => {
      queue.push(entry);
      const fn = wakeup;
      wakeup = null;
      fn?.();
    };

    const teeAdapter: IStorageAdapter = {
      append: async (entry) => {
        await this.adapter.append(entry);
        enqueue(entry);
      },
      readAll: (n, id) => this.adapter.readAll(n, id),
      lastCheckpoint: (n, id) => this.adapter.lastCheckpoint(n, id),
      listRuns: (n) => this.adapter.listRuns(n),
    };

    const teeDeps: WorkflowDeps = {
      control: this.control,
      resolveExec: (sandboxId) => resolveExecClient(this.control, sandboxId),
      adapter: teeAdapter,
    };

    // Emit run_started before kicking off execution
    enqueue({ ts: Date.now(), workflowName: name, runId, stepIndex: -1, event: LedgerEvent.RunStarted, payload: { workflowName: name, runId } });

    execute(teeDeps).finally(() => {
      done = true;
      const fn = wakeup;
      wakeup = null;
      fn?.();
    });

    return (async function* () {
      while (true) {
        while (queue.length > 0) yield queue.shift()!;
        if (done) break;
        await new Promise<void>((r) => { wakeup = r; });
      }
      while (queue.length > 0) yield queue.shift()!;
    })();
  }
}
