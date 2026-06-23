import {
  Sandbox,
  LedgerEvent,
  SandboxStatus,
  type IStorageAdapter,
  type SandboxDetails,
  type ListSandboxOptions,
  type ExecResult,
  type SandboxHooks,
} from "@drej/core";
import {
  ControlClient,
  SandboxState,
} from "@drej/opensandbox";

import { DrejError, type DrejOptions, type SandboxOptions } from "./types";

export { Sandbox } from "@drej/core";
export type { ExecHandle, ExecResult, ExecOptions, ExecCodeOptions } from "@drej/core";
export { LedgerEvent, SandboxStatus, SandboxError, ExecConnectionError, CommandError, StepTimeoutError } from "@drej/core";
export type { IStorageAdapter, SandboxDetails, ListSandboxOptions, LedgerEntry } from "@drej/core";
export { DrejError, type DrejOptions, type SandboxOptions } from "./types";

/**
 * Main entry point for drej. Manages sandbox lifecycle and session history.
 *
 * @example
 * ```ts
 * import { Drej } from "drej";
 * import { SQLiteAdapter } from "@drej/sqlite";
 *
 * const client = new Drej({
 *   baseUrl: "http://localhost:8080",
 *   adapter: new SQLiteAdapter("./drej.db"),
 * });
 *
 * const sb = await client.sandbox({ image: "node:22", resources: { cpu: "500m", memory: "256Mi" } });
 * await sb.exec("npm ci");
 * await sb.checkpoint();
 * await sb.exec("npm test").pipe(process.stdout);
 * await sb.close();
 * ```
 */
export class Drej {
  private readonly _control: ControlClient;
  private readonly _adapter: IStorageAdapter;
  private readonly _maxConcurrency: number | undefined;
  private _activeCount = 0;
  private readonly _waiters: Array<() => void> = [];
  private _connectPromise: Promise<void> | null = null;
  private _adapterClosed = false;

  constructor(options: DrejOptions) {
    this._control = new ControlClient({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey ?? "",
    });
    this._adapter = options.adapter;
    this._maxConcurrency = options.maxConcurrency;

    // Close the adapter when the event loop drains naturally (scripts, short-lived processes).
    // Long-running servers never reach beforeExit, so Postgres pools stay alive for the
    // lifetime of the process — which is the correct behaviour.
    process.setMaxListeners(process.getMaxListeners() + 1);
    process.on("beforeExit", () => {
      if (!this._adapterClosed) {
        this._adapterClosed = true;
        void this._adapter.close?.();
      }
    });
  }

  /** Lazily initialises the adapter on first use. Concurrent callers share the same promise. */
  private _ensureConnected(): Promise<void> {
    this._connectPromise ??= (this._adapter.connect?.() ?? Promise.resolve());
    return this._connectPromise;
  }

  /**
   * Create a new sandbox container and return a live `Sandbox` object.
   *
   * Waits until the container reaches `Running` state before returning.
   * Call `sb.close()` when done to release resources (use try/finally).
   *
   * @example
   * ```ts
   * const sb = await client.sandbox({ image: "node:22", resources: { cpu: "500m", memory: "256Mi" } });
   * try {
   *   await sb.exec("npm ci");
   *   await sb.exec("npm test").pipe(process.stdout);
   * } finally {
   *   await sb.close();
   * }
   * ```
   */
  async sandbox(opts: SandboxOptions): Promise<Sandbox> {
    await this._ensureConnected();
    await this._acquireSlot();

    const image = typeof opts.image === "string" ? { uri: opts.image } : opts.image;

    let sandboxId: string;
    try {
      const rawSb = await this._control.createSandbox({
        image,
        env: opts.env,
        entrypoint: ["tail", "-f", "/dev/null"],
        resourceLimits: opts.resources,
        timeout: opts.timeout,
      });
      sandboxId = rawSb.id;

      await this._waitForRunning(sandboxId);

      const name = opts.name ?? `sandbox-${sandboxId.slice(0, 8)}`;
      await this._adapter.append({
        ts: Date.now(),
        name,
        sandboxId,
        stepIndex: -1,
        event: LedgerEvent.SandboxCreated,
        payload: { sandboxId, resources: opts.resources },
      });

      const sb = new Sandbox(sandboxId, name, {
        control: this._control,
        adapter: this._adapter,
        hooks: opts.hooks,
        onClose: () => this._releaseSlot(),
      });
      opts.hooks?.onSandboxCreated?.(sandboxId, name);
      return sb;
    } catch (err) {
      this._releaseSlot();
      throw err;
    }
  }

  /**
   * Resume a sandbox session from its last checkpoint.
   *
   * Restores an OpenSandbox container from the snapshot captured by the most
   * recent `sb.checkpoint()` call. Execs that completed before the checkpoint
   * are returned from ledger cache without re-running; subsequent execs run
   * against the restored container.
   *
   * @example
   * ```ts
   * // original session (crashed mid-test)
   * const sb = await client.sandbox({ image: "node:22", name: "ci", resources: { cpu: "500m", memory: "256Mi" } });
   * await sb.exec("npm ci");
   * await sb.checkpoint();
   * await sb.exec("npm test");  // container dies here
   *
   * // resume later
   * const sb2 = await client.resume(originalSessionId);
   * await sb2.exec("npm ci");    // instant — replayed from ledger
   * await sb2.exec("npm test");  // actually runs on restored container
   * await sb2.close();
   * ```
   */
  async resume(sandboxId: string): Promise<Sandbox> {
    await this._ensureConnected();
    const allSessions = await this._adapter.listAllSandboxDetails();
    const session = allSessions.find((s) => s.sandboxId === sandboxId);
    if (!session) throw new DrejError(`Session ${sandboxId} not found`, 404);

    return this._resumeSession(session.name, sandboxId);
  }

  private async _resumeSession(name: string, sandboxId: string): Promise<Sandbox> {
    const entries = await this._adapter.readAll(name, sandboxId);

    const lastCheckpointIdx = entries.map((e) => e.event).lastIndexOf(LedgerEvent.CheckpointCreated);
    if (lastCheckpointIdx === -1) throw new DrejError(`No checkpoint found for session ${sandboxId}`, 404);

    const { snapshotId } = entries[lastCheckpointIdx].payload as { snapshotId: string };

    const createdEntry = entries.find((e) => e.event === LedgerEvent.SandboxCreated);
    const resources = (createdEntry?.payload as { resources?: { cpu?: string; memory?: string; gpu?: string } } | undefined)?.resources;

    const replayCache = new Map<number, ExecResult>();
    const pendingStdout = new Map<number, string[]>();
    const pendingStderr = new Map<number, string[]>();

    for (const entry of entries.slice(0, lastCheckpointIdx)) {
      if (entry.event === LedgerEvent.ExecStart) {
        const { seq } = entry.payload as { seq: number };
        pendingStdout.set(seq, []);
        pendingStderr.set(seq, []);
      } else if (entry.event === LedgerEvent.ExecEvent) {
        const { seq, type, text } = entry.payload as { seq: number; type: string; text?: string };
        if (text) {
          if (type === "stdout") pendingStdout.get(seq)?.push(text);
          else if (type === "stderr") pendingStderr.get(seq)?.push(text);
        }
      } else if (entry.event === LedgerEvent.ExecComplete) {
        const { seq, exitCode } = entry.payload as { seq: number; exitCode: number };
        replayCache.set(seq, {
          stdout: (pendingStdout.get(seq) ?? []).join(""),
          stderr: (pendingStderr.get(seq) ?? []).join(""),
          exitCode,
        });
      }
    }

    await this._acquireSlot();
    try {
      const rawSb = await this._control.createSandbox({ snapshotId, resourceLimits: resources });
      const newSessionId = rawSb.id;
      await this._waitForRunning(newSessionId);

      await this._adapter.append({
        ts: Date.now(),
        name,
        sandboxId: newSessionId,
        stepIndex: -1,
        event: LedgerEvent.SandboxCreated,
        payload: { sandboxId: newSessionId, resumedFrom: sandboxId, snapshotId },
      });

      return new Sandbox(newSessionId, name, {
        control: this._control,
        adapter: this._adapter,
        onClose: () => this._releaseSlot(),
      }, replayCache);
    } catch (err) {
      this._releaseSlot();
      throw err;
    }
  }

  /**
   * Sandbox history management. List, inspect, and delete past sandbox records.
   *
   * @example
   * ```ts
   * const all = await client.sandboxes.list();
   * const details = await client.sandboxes.get("ci", sandboxId);
   * await client.sandboxes.delete("ci", sandboxId);
   * ```
   */
  readonly sandboxes = {
    /** List all sandbox records across all names, newest first. */
    list: async (opts?: ListSandboxOptions): Promise<SandboxDetails[]> => {
      await this._ensureConnected();
      return this._adapter.listAllSandboxDetails(opts);
    },

    /** List sandbox records for a specific name, newest first. */
    listByName: async (name: string, opts?: ListSandboxOptions): Promise<SandboxDetails[]> => {
      await this._ensureConnected();
      return this._adapter.listSandboxDetails(name, opts);
    },

    /** Return details for a single sandbox record. Returns `null` if not found. */
    get: async (name: string, sandboxId: string): Promise<SandboxDetails | null> => {
      await this._ensureConnected();
      return this._adapter.getSandboxDetails(name, sandboxId);
    },

    /** Delete all ledger events for a sandbox. */
    delete: async (name: string, sandboxId: string): Promise<void> => {
      await this._ensureConnected();
      return this._adapter.deleteSandbox(name, sandboxId);
    },
  };

  // ── Internal ──────────────────────────────────────────────────────────────

  private async _waitForRunning(sandboxId: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = await this._control.getSandbox(sandboxId);
      if (s.status.state === SandboxState.Running) return;
      if (s.status.state === SandboxState.Failed || s.status.state === SandboxState.Terminated) {
        throw new DrejError(`Sandbox ${sandboxId} entered state ${s.status.state}: ${s.status.message ?? ""}`, 500);
      }
      await new Promise<void>((r) => setTimeout(r, 1_000));
    }
    throw new DrejError(`Sandbox ${sandboxId} did not reach Running within ${timeoutMs}ms`, 408);
  }

  private async _acquireSlot(): Promise<void> {
    if (!this._maxConcurrency || this._activeCount < this._maxConcurrency) {
      this._activeCount++;
      return;
    }
    await new Promise<void>((resolve) => this._waiters.push(resolve));
    this._activeCount++;
  }

  private _releaseSlot(): void {
    this._activeCount--;
    this._waiters.shift()?.();
  }
}
