export enum LedgerEvent {
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
  workflowId: string;
  stepIndex: number;
  branch?: number; // set by parallel steps to identify which concurrent branch emitted this entry
  event: LedgerEvent;
  payload?: unknown;
  error?: string;
}

export interface ILedger {
  append(entry: LedgerEntry): Promise<void>;
  readAll(workflowId: string): Promise<LedgerEntry[]>;
  lastCheckpoint(workflowId: string): Promise<LedgerEntry | null>;
}

export class MemoryLedger implements ILedger {
  private readonly entries: LedgerEntry[] = [];

  async append(entry: LedgerEntry): Promise<void> {
    this.entries.push(entry);
  }

  async readAll(workflowId: string): Promise<LedgerEntry[]> {
    return this.entries.filter((e) => e.workflowId === workflowId);
  }

  async lastCheckpoint(workflowId: string): Promise<LedgerEntry | null> {
    const all = await this.readAll(workflowId);
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].event === LedgerEvent.Checkpoint) return all[i];
    }
    return null;
  }
}

// Each workflow gets its own <dir>/<workflowId>.ndjson file.
// Bun.write creates parent directories automatically on first write.
export class NdjsonLedger implements ILedger {
  constructor(private readonly dir: string) {}

  private filePath(workflowId: string): string {
    return `${this.dir}/${workflowId}.ndjson`;
  }

  async append(entry: LedgerEntry): Promise<void> {
    const path = this.filePath(entry.workflowId);
    const existing = await Bun.file(path).text().catch(() => "");
    await Bun.write(path, existing + JSON.stringify(entry) + "\n");
  }

  async readAll(workflowId: string): Promise<LedgerEntry[]> {
    try {
      const text = await Bun.file(this.filePath(workflowId)).text();
      return text
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as LedgerEntry);
    } catch {
      return [];
    }
  }

  async lastCheckpoint(workflowId: string): Promise<LedgerEntry | null> {
    const all = await this.readAll(workflowId);
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].event === LedgerEvent.Checkpoint) return all[i];
    }
    return null;
  }
}
