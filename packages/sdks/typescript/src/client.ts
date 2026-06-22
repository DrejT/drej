import {
  Workflow,
  LedgerEvent,
  StepType,
  buildStep,
  mergeHooks,
  shouldSnapshot,
  waitForSnapshot,
  type WorkflowDeps,
  type WorkflowHooks,
  type IStorageAdapter,
  type SnapshotConfig,
  type StepDef,
  type RunDetails,
  type ListRunsOptions,
} from "@drej/core";
export { WorkflowError, SandboxError, ExecConnectionError, CommandError, StepTimeoutError, WorkflowStatus, RunStatus, StepType, Encoding, Backoff } from "@drej/core";
export type {
  WorkflowHooks,
  WorkflowHookInfo,
  StepHookInfo,
  StepCompleteHookInfo,
  StepFailedHookInfo,
  WorkflowCompleteHookInfo,
  WorkflowFailedHookInfo,
  RunDetails,
  ListRunsOptions,
} from "@drej/core";
import {
  ControlClient,
  SandboxState,
  type Sandbox,
  type CreateSandboxOptions,
  type ListSandboxesOptions,
  type Snapshot,
  type ListSnapshotsOptions,
  type DiagnosticLog,
  type DiagnosticEvent,
} from "@drej/opensandbox";
import { DrejError, RunHandle, WorkflowRun, type DrejOptions, type RunOptions, type WorkflowEvent } from "./types";
import { makeStream } from "./stream";
import type { WorkflowBuilder } from "./builder/index";

export { LedgerEvent };
export type { LedgerEntry, SnapshotConfig, StepDef, IStorageAdapter } from "@drej/core";
export type {
  Sandbox,
  CreateSandboxOptions,
  ListSandboxesOptions,
  Snapshot,
  ListSnapshotsOptions,
  DiagnosticLog,
  DiagnosticEvent,
} from "@drej/opensandbox";
export { SandboxState, SnapshotState, SSEEventType } from "@drej/opensandbox";
export type { SandboxStatus, Resources, ImageSpec, ImageAuth } from "@drej/opensandbox";
export { DrejError, RunHandle, WorkflowRun, type DrejOptions, type RunOptions, type WorkflowEvent } from "./types";

/**
 * Main entry point for drej. Manages workflow execution, sandbox lifecycle,
 * snapshots, and run history.
 *
 * @example
 * ```ts
 * import { Drej, workflow } from "drej";
 * import { SQLiteAdapter } from "@drej/sqlite";
 *
 * const client = new Drej({
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
 * await run.pipe(process.stdout);
 * await client.close();
 * ```
 */
export class Drej {
  private readonly control: ControlClient;
  private readonly adapter: IStorageAdapter;
  private readonly _maxConcurrency: number | undefined;
  private _activeRuns = 0;
  private readonly _waiters: Array<() => void> = [];

  constructor(options: DrejOptions) {
    this.control = new ControlClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey ?? "",
    });
    this.adapter = options.adapter;
    this._maxConcurrency = options.maxConcurrency;
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
      if (state === SandboxState.Running) return sandbox;
      if (state === SandboxState.Failed || state === SandboxState.Terminated) {
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
   *   if (ev.event === "exec_event") {
   *     const { text } = ev.payload as { text?: string };
   *     if (text) process.stdout.write(text);
   *   }
   * }
   * ```
   */
  run(w: WorkflowBuilder, options?: RunOptions): RunHandle {
    return new RunHandle(this._run(w, options));
  }

  private async _run(w: WorkflowBuilder, options?: RunOptions): Promise<WorkflowRun> {
    await this._acquireSlot();
    const { name, steps, initialState } = w.build();
    const runId = crypto.randomUUID();
    const ctrl = new AbortController();
    options?.signal?.addEventListener("abort", () => ctrl.abort(options.signal!.reason), { once: true });
    return new WorkflowRun(
      name,
      runId,
      this._withRelease(this._execute(name, runId, steps, options, initialState, ctrl.signal)),
      () => ctrl.abort(),
    );
  }

  /**
   * Re-run a workflow starting from a previously captured sandbox snapshot.
   * The new run boots from the snapshot image, skipping any steps that ran
   * before the snapshot was taken (e.g. dependency installs).
   *
   * The original run must contain a `LedgerEvent.Snapshot` entry — produced
   * either by a `s.snapshot()` step in the workflow or by the
   * `snapshotConfig` option passed to `client.run()`.
   */
  replayFromSnapshot(name: string, runId: string, w: WorkflowBuilder, options?: RunOptions): RunHandle {
    return new RunHandle(this._replayFromSnapshot(name, runId, w, options));
  }

  private async _replayFromSnapshot(name: string, runId: string, w: WorkflowBuilder, options?: RunOptions): Promise<WorkflowRun> {
    const entries = await this.adapter.readAll(name, runId);
    const snapEntry = [...entries].reverse().find((e) => e.event === LedgerEvent.Snapshot);
    if (!snapEntry) throw new DrejError(`No snapshot found in ledger for ${name}/${runId}`, 404);
    const { snapshotId } = snapEntry.payload as { snapshotId: string };

    const { name: wfName, steps } = w.build();
    const replaySteps: StepDef[] = steps.map((s) =>
      s.type === StepType.CreateSandbox ? { ...s, snapshotId } : s,
    );
    const replayRunId = crypto.randomUUID();
    const ctrl = new AbortController();
    options?.signal?.addEventListener("abort", () => ctrl.abort(options.signal!.reason), { once: true });
    return new WorkflowRun(
      wfName,
      replayRunId,
      this._execute(wfName, replayRunId, replaySteps, options, {}, ctrl.signal),
      () => ctrl.abort(),
    );
  }

  /**
   * Resume an interrupted workflow run from its last checkpoint.
   *
   * Reads the ledger to find the furthest completed step, then re-runs
   * the workflow starting from the next step. Steps that already completed
   * are not re-executed.
   */
  resumeRun(name: string, runId: string, w: WorkflowBuilder, options?: RunOptions): RunHandle {
    return new RunHandle(this._resumeRun(name, runId, w, options));
  }

  private async _resumeRun(name: string, runId: string, w: WorkflowBuilder, options?: RunOptions): Promise<WorkflowRun> {
    const { steps } = w.build();
    const workflowSteps = steps.map(buildStep);

    const ctrl = new AbortController();
    options?.signal?.addEventListener("abort", () => ctrl.abort(options.signal!.reason), { once: true });

    const stream = makeStream(name, runId, this.adapter, this.control, async (teeDeps) => {
      const deps: WorkflowDeps = { ...teeDeps, signal: ctrl.signal, stepTimeoutMs: options?.stepTimeoutMs };
      const { workflow, nextStep, lastOutput } = await Workflow.resumeFromLedger(
        name,
        runId,
        workflowSteps,
        deps,
      );
      try {
        await workflow.run(lastOutput, nextStep);
      } catch {
        try { await workflow.rollback(); } catch { /* ignore */ }
      }
    });

    return new WorkflowRun(name, runId, stream, () => ctrl.abort());
  }

  // ── Run management ────────────────────────────────────────────────────────

  /** Return details for all runs of a workflow, newest first. */
  listRunDetails(workflowName: string, opts?: ListRunsOptions): Promise<RunDetails[]> {
    return this.adapter.listRunDetails(workflowName, opts);
  }

  /** Return details for runs across all workflows, newest first. */
  listAllRunDetails(opts?: ListRunsOptions): Promise<RunDetails[]> {
    return this.adapter.listAllRunDetails(opts);
  }

  /** Return details for a single run. Throws if the run does not exist. */
  async getRunDetails(workflowName: string, runId: string): Promise<RunDetails> {
    const details = await this.adapter.getRunDetails(workflowName, runId);
    if (!details) throw new DrejError(`Run ${runId} not found under workflow "${workflowName}"`, 404);
    return details;
  }

  /** Return all ledger events for a specific run, in ascending order. */
  getRunLedger(workflowName: string, runId: string): Promise<WorkflowEvent[]> {
    return this.adapter.readAll(workflowName, runId) as Promise<WorkflowEvent[]>;
  }

  /** Delete all ledger events for a run. */
  deleteRun(workflowName: string, runId: string): Promise<void> {
    return this.adapter.deleteRun(workflowName, runId);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async _acquireSlot(): Promise<void> {
    if (!this._maxConcurrency || this._activeRuns < this._maxConcurrency) {
      this._activeRuns++;
      return;
    }
    await new Promise<void>((resolve) => this._waiters.push(resolve));
    this._activeRuns++;
  }

  private _releaseSlot(): void {
    this._activeRuns--;
    const next = this._waiters.shift();
    next?.();
  }

  private async *_withRelease(gen: AsyncGenerator<WorkflowEvent>): AsyncGenerator<WorkflowEvent> {
    try {
      yield* gen;
    } finally {
      this._releaseSlot();
    }
  }

  private _execute(
    name: string,
    runId: string,
    steps: StepDef[],
    options?: RunOptions,
    initialState: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): AsyncGenerator<WorkflowEvent> {
    return makeStream(name, runId, this.adapter, this.control, async (teeDeps) => {
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

      const deps: WorkflowDeps = { ...teeDeps, hooks: mergeHooks(snapshotHook, options?.hooks), stepTimeoutMs: options?.stepTimeoutMs, signal };
      const wf = new Workflow(name, runId, steps.map(buildStep), deps);
      try {
        await wf.run(initialState);
      } catch (err) {
        try { await wf.rollback(); } catch { /* ignore */ }
        throw err;
      }
    });
  }
}
