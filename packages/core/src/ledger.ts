export interface LedgerEntry {
  ts: number;
  workflowId: string;
  stepIndex: number;
  event:
    | "step_start"
    | "step_complete"
    | "step_failed"
    | "step_rolled_back"
    | "workflow_complete"
    | "workflow_failed"
    | "checkpoint"
    | "exec_event";
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
      if (all[i].event === "checkpoint") return all[i];
    }
    return null;
  }
}

export class NdjsonLedger implements ILedger {
  constructor(private readonly filePath: string) {}

  async append(entry: LedgerEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    const existing = await Bun.file(this.filePath).text().catch(() => "");
    await Bun.write(this.filePath, existing + line);
  }

  async readAll(workflowId: string): Promise<LedgerEntry[]> {
    return (await this.parseAll()).filter((e) => e.workflowId === workflowId);
  }

  async lastCheckpoint(workflowId: string): Promise<LedgerEntry | null> {
    const all = await this.readAll(workflowId);
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].event === "checkpoint") return all[i];
    }
    return null;
  }

  private async parseAll(): Promise<LedgerEntry[]> {
    try {
      const text = await Bun.file(this.filePath).text();
      return text
        .split("\n")
        .filter((line: string) => line.length > 0)
        .map((line: string) => JSON.parse(line) as LedgerEntry);
    } catch {
      return [];
    }
  }
}
