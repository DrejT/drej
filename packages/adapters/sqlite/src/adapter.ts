import { Database } from "bun:sqlite";
import type { IStorageAdapter, LedgerEntry, LedgerEvent, RunDetails, ListRunsOptions } from "@drej/core";
import { RunStatus } from "@drej/core";
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

type AggRow = {
  wf_name: string;
  run_id: string;
  started_at: number | null;
  completed_at: number | null;
  terminal_event: string | null;
  error_msg: string | null;
  step_count: number;
};

const AGG_SQL = (whereClause: string) => `
  WITH agg AS (
    SELECT
      wf_name,
      run_id,
      MIN(CASE WHEN event = 'run_started' THEN ts END) AS started_at,
      MAX(CASE WHEN event IN ('workflow_complete', 'workflow_failed') THEN ts END) AS completed_at,
      MAX(CASE WHEN event IN ('workflow_complete', 'workflow_failed') THEN event END) AS terminal_event,
      MAX(CASE WHEN event = 'workflow_failed' THEN error END) AS error_msg,
      CAST(COUNT(CASE WHEN event = 'step_complete' THEN 1 END) AS INTEGER) AS step_count
    FROM drej_events
    ${whereClause}
    GROUP BY wf_name, run_id
  )
  SELECT * FROM agg WHERE started_at IS NOT NULL ORDER BY started_at DESC
`;

function terminalToStatus(event: string | null): RunStatus {
  if (event === "workflow_complete") return RunStatus.Completed;
  if (event === "workflow_failed") return RunStatus.Failed;
  return RunStatus.Running;
}

function aggRowToDetails(row: AggRow): RunDetails {
  return {
    workflowName: row.wf_name,
    runId: row.run_id,
    status: terminalToStatus(row.terminal_event),
    startedAt: row.started_at!,
    completedAt: row.completed_at ?? undefined,
    stepCount: row.step_count,
    error: row.error_msg ?? undefined,
  };
}

function applyOpts(details: RunDetails[], opts?: ListRunsOptions): RunDetails[] {
  let result = details;
  if (opts?.before != null) result = result.filter((d) => d.startedAt < opts.before!);
  if (opts?.status != null) result = result.filter((d) => d.status === opts.status);
  if (opts?.limit != null) result = result.slice(0, opts.limit);
  return result;
}

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

  async listRunDetails(workflowName: string, opts?: ListRunsOptions): Promise<RunDetails[]> {
    const rows = this.db
      .prepare<AggRow, [string]>(AGG_SQL("WHERE wf_name = ?"))
      .all(workflowName);
    return applyOpts(rows.map(aggRowToDetails), opts);
  }

  async listAllRunDetails(opts?: ListRunsOptions): Promise<RunDetails[]> {
    const rows = this.db.prepare<AggRow, []>(AGG_SQL("")).all();
    return applyOpts(rows.map(aggRowToDetails), opts);
  }

  async getRunDetails(workflowName: string, runId: string): Promise<RunDetails | null> {
    const row = this.db
      .prepare<AggRow, [string, string]>(AGG_SQL("WHERE wf_name = ? AND run_id = ?"))
      .get(workflowName, runId);
    return row ? aggRowToDetails(row) : null;
  }

  async deleteRun(workflowName: string, runId: string): Promise<void> {
    this.db
      .prepare<void, [string, string]>(`DELETE FROM drej_events WHERE wf_name = ? AND run_id = ?`)
      .run(workflowName, runId);
  }
}
