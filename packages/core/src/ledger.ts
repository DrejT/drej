
export enum LedgerEvent {
  RunStarted = "run_started",
  StepStart = "step_start",
  StepComplete = "step_complete",
  StepFailed = "step_failed",
  StepRolledBack = "step_rolled_back",
  WorkflowComplete = "workflow_complete",
  WorkflowFailed = "workflow_failed",
  Checkpoint = "checkpoint",
  ExecEvent = "exec_event",
  Snapshot = "snapshot",
}

export interface LedgerEntry {
  ts: number;
  workflowName: string;
  runId: string;
  stepIndex: number;
  branch?: number;
  event: LedgerEvent;
  payload?: unknown;
  error?: string;
}

export interface ILedger {
  append(entry: LedgerEntry): Promise<void>;
  readAll(workflowName: string, runId: string): Promise<LedgerEntry[]>;
  lastCheckpoint(workflowName: string, runId: string): Promise<LedgerEntry | null>;
  listRuns(workflowName: string): Promise<string[]>;
}

export class MemoryLedger implements ILedger {
  private readonly entries: LedgerEntry[] = [];

  async append(entry: LedgerEntry): Promise<void> {
    this.entries.push(entry);
  }

  async readAll(workflowName: string, runId: string): Promise<LedgerEntry[]> {
    return this.entries.filter((e) => e.workflowName === workflowName && e.runId === runId);
  }

  async lastCheckpoint(workflowName: string, runId: string): Promise<LedgerEntry | null> {
    const all = await this.readAll(workflowName, runId);
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].event === LedgerEvent.Checkpoint) return all[i];
    }
    return null;
  }

  async listRuns(workflowName: string): Promise<string[]> {
    const seen = new Set<string>();
    for (const e of this.entries) {
      if (e.workflowName === workflowName) seen.add(e.runId);
    }
    return [...seen];
  }
}

// Each entry gets its own file: <dir>/<workflowName>/<runId>/<ts>-<rand>.ndjson
// Bun.write to a new path never truncates existing entries — safe on crash.
// readAll globs all entry files and sorts by the ts field for deterministic order.
export class NdjsonLedger implements ILedger {
  constructor(private readonly dir: string) {}

  private runDir(workflowName: string, runId: string): string {
    return `${this.dir}/${workflowName}/${runId}`;
  }

  async append(entry: LedgerEntry): Promise<void> {
    const dir = this.runDir(entry.workflowName, entry.runId);
    const filename = `${entry.ts}-${Math.random().toString(36).slice(2)}.ndjson`;
    await Bun.write(`${dir}/${filename}`, JSON.stringify(entry) + "\n");
  }

  async readAll(workflowName: string, runId: string): Promise<LedgerEntry[]> {
    const dir = this.runDir(workflowName, runId);
    const entries: LedgerEntry[] = [];
    try {
      const glob = new Bun.Glob("*.ndjson");
      for await (const f of glob.scan({ cwd: dir, onlyFiles: true })) {
        try {
          const text = await Bun.file(`${dir}/${f}`).text();
          const line = text.trim();
          if (line) entries.push(JSON.parse(line) as LedgerEntry);
        } catch {
          // skip corrupted entry files
        }
      }
    } catch {
      return [];
    }
    return entries.sort((a, b) => a.ts - b.ts);
  }

  async lastCheckpoint(workflowName: string, runId: string): Promise<LedgerEntry | null> {
    const all = await this.readAll(workflowName, runId);
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].event === LedgerEvent.Checkpoint) return all[i];
    }
    return null;
  }

  async listRuns(workflowName: string): Promise<string[]> {
    try {
      // Each run is a subdirectory. Glob one level deep for any .ndjson entry file,
      // extract the directory segment (the runId), and deduplicate.
      const glob = new Bun.Glob("*/*.ndjson");
      const seen = new Set<string>();
      for await (const f of glob.scan({ cwd: `${this.dir}/${workflowName}`, onlyFiles: true })) {
        const runId = f.split("/")[0];
        if (runId) seen.add(runId);
      }
      return [...seen];
    } catch {
      return [];
    }
  }
}
