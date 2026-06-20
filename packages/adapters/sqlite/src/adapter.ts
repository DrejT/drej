import { Database } from "bun:sqlite";
import type { IStorageAdapter, LedgerEntry, LedgerEvent } from "@drej/core";
import { MIGRATION_SQL } from "./migrations";

type Row = {
  run_id: string;
  wf_name: string;
  step_idx: number;
  branch: number | null;
  event: string;
  payload: string | null;
  error: string | null;
  ts: number;
};

function rowToEntry(row: Row): LedgerEntry {
  return {
    runId: row.run_id,
    workflowName: row.wf_name,
    stepIndex: row.step_idx,
    branch: row.branch ?? undefined,
    event: row.event as LedgerEvent,
    payload: row.payload !== null ? (JSON.parse(row.payload) as unknown) : undefined,
    error: row.error ?? undefined,
    ts: row.ts,
  };
}

export class SQLiteAdapter implements IStorageAdapter {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
  }

  async connect(): Promise<void> {
    this.db.exec(MIGRATION_SQL);
    // WAL mode prevents writer from blocking readers on concurrent access
    this.db.exec("PRAGMA journal_mode = WAL;");
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async append(entry: LedgerEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO drej_events (run_id, wf_name, step_idx, branch, event, payload, error, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.runId,
        entry.workflowName,
        entry.stepIndex,
        entry.branch ?? null,
        entry.event,
        entry.payload !== undefined ? JSON.stringify(entry.payload) : null,
        entry.error ?? null,
        entry.ts,
      );
  }

  async readAll(workflowName: string, runId: string): Promise<LedgerEntry[]> {
    const rows = this.db
      .prepare<Row, [string, string]>(
        `SELECT run_id, wf_name, step_idx, branch, event, payload, error, ts
         FROM drej_events
         WHERE wf_name = ? AND run_id = ?
         ORDER BY ts ASC`,
      )
      .all(workflowName, runId);
    return rows.map(rowToEntry);
  }

  async lastCheckpoint(workflowName: string, runId: string): Promise<LedgerEntry | null> {
    const row = this.db
      .prepare<Row, [string, string]>(
        `SELECT run_id, wf_name, step_idx, branch, event, payload, error, ts
         FROM drej_events
         WHERE wf_name = ? AND run_id = ? AND event = 'checkpoint'
         ORDER BY ts DESC
         LIMIT 1`,
      )
      .get(workflowName, runId);
    return row ? rowToEntry(row) : null;
  }

  async listRuns(workflowName: string): Promise<string[]> {
    const rows = this.db
      .prepare<{ run_id: string }, [string]>(
        `SELECT DISTINCT run_id FROM drej_events WHERE wf_name = ?`,
      )
      .all(workflowName);
    return rows.map((r) => r.run_id);
  }
}
