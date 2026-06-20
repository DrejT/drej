import {
  Workflow,
  NdjsonAdapter,
  MemoryAdapter,
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
} from "@drej/core";
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
} from "@drej/opensandbox";
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
} from "@drej/opensandbox";
export type { SandboxStatus, SnapshotState, Resources, ImageSpec, ImageAuth } from "@drej/opensandbox";

export class DrejError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DrejError";
  }
}

export interface DrejClientOptions {
  /** OpenSandbox server URL */
  baseUrl: string;
  /** OpenSandbox API key (empty string for local dev) */
  apiKey?: string;
  /**
   * Pluggable storage adapter. Implement IStorageAdapter to use any database.
   * Defaults to an in-memory adapter when omitted.
   */
  adapter?: IStorageAdapter;
  /** Directory for durable NDJSON storage. Shorthand for `adapter: new NdjsonAdapter(dir)`. */
  ledgerDir?: string;
}

export interface RunOptions {
  snapshotConfig?: SnapshotConfig;
}

// WorkflowEvent is a ledger entry — the same record emitted during execution
// and stored in the adapter.
export type WorkflowEvent = LedgerEntry;

export class WorkflowRun implements AsyncIterable<WorkflowEvent> {
  constructor(
    public readonly name: string,
    public readonly id: string,
    private readonly _events: AsyncGenerator<WorkflowEvent>,
  ) {}

  [Symbol.asyncIterator](): AsyncIterator<WorkflowEvent> {
    return this._events;
  }
}

export class DrejClient {
  private readonly control: ControlClient;
  private readonly adapter: IStorageAdapter;

  constructor(options: DrejClientOptions) {
    this.control = new ControlClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey ?? "",
    });
    if (options.adapter) {
      this.adapter = options.adapter;
    } else if (options.ledgerDir) {
      this.adapter = new NdjsonAdapter(options.ledgerDir);
    } else {
      this.adapter = new MemoryAdapter();
    }
  }

  /** Call once before first use when using a DB-backed adapter. */
  async connect(): Promise<void> {
    await this.adapter.connect?.();
  }

  /** Releases adapter resources (e.g. closes DB connection pool). */
  async close(): Promise<void> {
    await this.adapter.close?.();
  }

  // ── Sandbox management ────────────────────────────────────────────────────

  createSandbox(options: CreateSandboxOptions): Promise<Sandbox> {
    return this.control.createSandbox(options);
  }

  listSandboxes(options: ListSandboxesOptions = {}): Promise<Sandbox[]> {
    return this.control.listSandboxes(options);
  }

  getSandbox(id: string): Promise<Sandbox> {
    return this.control.getSandbox(id);
  }

  deleteSandbox(id: string): Promise<void> {
    return this.control.deleteSandbox(id);
  }

  pauseSandbox(id: string): Promise<void> {
    return this.control.pauseSandbox(id);
  }

  resumeSandbox(id: string): Promise<void> {
    return this.control.resumeSandbox(id);
  }

  renewSandbox(id: string): Promise<void> {
    return this.control.renewExpiration(id);
  }

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

  createSnapshot(sandboxId: string): Promise<Snapshot> {
    return this.control.createSnapshot(sandboxId);
  }

  listSnapshots(options: ListSnapshotsOptions = {}): Promise<Snapshot[]> {
    return this.control.listSnapshots(options);
  }

  getSnapshot(id: string): Promise<Snapshot> {
    return this.control.getSnapshot(id);
  }

  deleteSnapshot(id: string): Promise<void> {
    return this.control.deleteSnapshot(id);
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  getDiagnosticLogs(sandboxId: string): Promise<DiagnosticLog[]> {
    return this.control.getDiagnosticLogs(sandboxId);
  }

  getDiagnosticEvents(sandboxId: string): Promise<DiagnosticEvent[]> {
    return this.control.getDiagnosticEvents(sandboxId);
  }

  // ── Workflow execution ────────────────────────────────────────────────────

  async run(
    w: WorkflowBuilder,
    options?: RunOptions,
  ): Promise<WorkflowRun> {
    const { name, steps } = w.build();
    const runId = crypto.randomUUID();
    return new WorkflowRun(name, runId, this._execute(name, runId, steps, options));
  }

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

  listRuns(workflowName: string): Promise<string[]> {
    return this.adapter.listRuns(workflowName);
  }

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
