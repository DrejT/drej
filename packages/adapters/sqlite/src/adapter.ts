import { Database } from "bun:sqlite";
import type { IStorageAdapter, LedgerEntry, LedgerEvent, SandboxDetails, ListSandboxOptions } from "@drej/core";
import { SandboxStatus } from "@drej/core";
import { MIGRATION_SQL } from "./migrations";

type Row = {
  sandbox_id: string;
  name: string;
  step_idx: number;
  branch: number | null;
  event: string;
  payload: string | null;
  error: string | null;
  ts: number;
};

type AggRow = {
  name: string;
  sandbox_id: string;
  started_at: number | null;
  completed_at: number | null;
  is_closed: number;
  exec_count: number;
};

const AGG_SQL = (whereClause: string) => `
  WITH agg AS (
    SELECT
      name,
      sandbox_id,
      MIN(CASE WHEN event = 'sandbox_created' THEN ts END) AS started_at,
      MAX(CASE WHEN event = 'sandbox_closed'  THEN ts END) AS completed_at,
      MAX(CASE WHEN event = 'sandbox_closed'  THEN 1 ELSE 0 END) AS is_closed,
      CAST(COUNT(CASE WHEN event = 'exec_complete' THEN 1 END) AS INTEGER) AS exec_count
    FROM drej_events
    ${whereClause}
    GROUP BY name, sandbox_id
  )
  SELECT * FROM agg WHERE started_at IS NOT NULL ORDER BY started_at DESC
`;

function aggRowToDetails(row: AggRow): SandboxDetails {
  return {
    name: row.name,
    sandboxId: row.sandbox_id,
    status: row.is_closed ? SandboxStatus.Completed : SandboxStatus.Running,
    startedAt: row.started_at!,
    completedAt: row.completed_at ?? undefined,
    execCount: row.exec_count,
  };
}

function applyOpts(details: SandboxDetails[], opts?: ListSandboxOptions): SandboxDetails[] {
  let result = details;
  if (opts?.before != null) result = result.filter((d) => d.startedAt < opts.before!);
  if (opts?.status != null) result = result.filter((d) => d.status === opts.status);
  if (opts?.limit != null) result = result.slice(0, opts.limit);
  return result;
}

function rowToEntry(row: Row): LedgerEntry {
  return {
    sandboxId: row.sandbox_id,
    name: row.name,
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
        `INSERT INTO drej_events (sandbox_id, name, step_idx, branch, event, payload, error, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.sandboxId,
        entry.name,
        entry.stepIndex,
        entry.branch ?? null,
        entry.event,
        entry.payload !== undefined ? JSON.stringify(entry.payload) : null,
        entry.error ?? null,
        entry.ts,
      );
  }

  async readAll(name: string, sandboxId: string): Promise<LedgerEntry[]> {
    const rows = this.db
      .prepare<Row, [string, string]>(
        `SELECT sandbox_id, name, step_idx, branch, event, payload, error, ts
         FROM drej_events
         WHERE name = ? AND sandbox_id = ?
         ORDER BY ts ASC`,
      )
      .all(name, sandboxId);
    return rows.map(rowToEntry);
  }

  async lastCheckpoint(name: string, sandboxId: string): Promise<LedgerEntry | null> {
    const row = this.db
      .prepare<Row, [string, string]>(
        `SELECT sandbox_id, name, step_idx, branch, event, payload, error, ts
         FROM drej_events
         WHERE name = ? AND sandbox_id = ? AND event = 'checkpoint_created'
         ORDER BY ts DESC
         LIMIT 1`,
      )
      .get(name, sandboxId);
    return row ? rowToEntry(row) : null;
  }

  async listSandboxDetails(name: string, opts?: ListSandboxOptions): Promise<SandboxDetails[]> {
    const rows = this.db
      .prepare<AggRow, [string]>(AGG_SQL("WHERE name = ?"))
      .all(name);
    return applyOpts(rows.map(aggRowToDetails), opts);
  }

  async listAllSandboxDetails(opts?: ListSandboxOptions): Promise<SandboxDetails[]> {
    const rows = this.db.prepare<AggRow, []>(AGG_SQL("")).all();
    return applyOpts(rows.map(aggRowToDetails), opts);
  }

  async getSandboxDetails(name: string, sandboxId: string): Promise<SandboxDetails | null> {
    const row = this.db
      .prepare<AggRow, [string, string]>(AGG_SQL("WHERE name = ? AND sandbox_id = ?"))
      .get(name, sandboxId);
    return row ? aggRowToDetails(row) : null;
  }

  async deleteSandbox(name: string, sandboxId: string): Promise<void> {
    this.db
      .prepare<void, [string, string]>(`DELETE FROM drej_events WHERE name = ? AND sandbox_id = ?`)
      .run(name, sandboxId);
  }
}
