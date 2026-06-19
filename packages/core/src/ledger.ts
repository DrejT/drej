
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

// Each run gets its own <dir>/<workflowName>/<runId>.ndjson file.
// Bun.write creates parent directories automatically on first write.
export class NdjsonLedger implements ILedger {
  constructor(private readonly dir: string) {}

  private filePath(workflowName: string, runId: string): string {
    return `${this.dir}/${workflowName}/${runId}.ndjson`;
  }

  async append(entry: LedgerEntry): Promise<void> {
    const path = this.filePath(entry.workflowName, entry.runId);
    const existing = await Bun.file(path).text().catch(() => "");
    await Bun.write(path, existing + JSON.stringify(entry) + "\n");
  }

  async readAll(workflowName: string, runId: string): Promise<LedgerEntry[]> {
    try {
      const text = await Bun.file(this.filePath(workflowName, runId)).text();
      return text
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as LedgerEntry);
    } catch {
      return [];
    }
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
      const glob = new Bun.Glob("*.ndjson");
      const files: string[] = [];
      for await (const f of glob.scan({ cwd: `${this.dir}/${workflowName}`, onlyFiles: true })) {
        files.push(f.slice(0, -7)); // strip .ndjson
      }
      return files;
    } catch {
      return [];
    }
  }
}
