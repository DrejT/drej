import postgres from "postgres";
import type { IStorageAdapter, LedgerEntry, LedgerEvent, RunDetails, ListRunsOptions } from "@drej/core";
import { RunStatus } from "@drej/core";
import { MIGRATION_SQL } from "./migrations";

type Row = {
  run_id: string;
  wf_name: string;
  step_idx: number;
  branch: number | null;
  event: string;
  payload: unknown;
  error: string | null;
  ts: string;
};

type AggRow = {
  wf_name: string;
  run_id: string;
  started_at: string | null;
  completed_at: string | null;
  terminal_event: string | null;
  error_msg: string | null;
  step_count: string;
};

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
    startedAt: Number(row.started_at),
    completedAt: row.completed_at != null ? Number(row.completed_at) : undefined,
    stepCount: Number(row.step_count),
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
    payload: row.payload ?? undefined,
    error: row.error ?? undefined,
    ts: Number(row.ts),
  };
}

export class PostgresAdapter implements IStorageAdapter {
  private readonly sql: ReturnType<typeof postgres>;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString);
  }

  async connect(): Promise<void> {
    await this.sql.unsafe(MIGRATION_SQL);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async append(entry: LedgerEntry): Promise<void> {
    await this.sql`
      INSERT INTO drej_events (run_id, wf_name, step_idx, branch, event, payload, error, ts)
      VALUES (
        ${entry.runId},
        ${entry.workflowName},
        ${entry.stepIndex},
        ${entry.branch ?? null},
        ${entry.event},
        ${entry.payload !== undefined ? JSON.stringify(entry.payload) : null},
        ${entry.error ?? null},
        ${entry.ts}
      )
    `;
  }

  async readAll(workflowName: string, runId: string): Promise<LedgerEntry[]> {
    const rows = await this.sql<Row[]>`
      SELECT run_id, wf_name, step_idx, branch, event, payload, error, ts
      FROM drej_events
      WHERE wf_name = ${workflowName} AND run_id = ${runId}
      ORDER BY ts ASC
    `;
    return rows.map(rowToEntry);
  }

  async lastCheckpoint(workflowName: string, runId: string): Promise<LedgerEntry | null> {
    const rows = await this.sql<Row[]>`
      SELECT run_id, wf_name, step_idx, branch, event, payload, error, ts
      FROM drej_events
      WHERE wf_name = ${workflowName} AND run_id = ${runId} AND event = 'checkpoint'
      ORDER BY ts DESC
      LIMIT 1
    `;
    return rows.length ? rowToEntry(rows[0]) : null;
  }

  private async _aggQuery(whereClause: string, params: string[]): Promise<AggRow[]> {
    return this.sql.unsafe<AggRow[]>(
      `WITH agg AS (
        SELECT
          wf_name,
          run_id,
          MIN(CASE WHEN event = 'run_started' THEN ts END) AS started_at,
          MAX(CASE WHEN event IN ('workflow_complete', 'workflow_failed') THEN ts END) AS completed_at,
          MAX(CASE WHEN event IN ('workflow_complete', 'workflow_failed') THEN event END) AS terminal_event,
          MAX(CASE WHEN event = 'workflow_failed' THEN error END) AS error_msg,
          COUNT(CASE WHEN event = 'step_complete' THEN 1 END)::int AS step_count
        FROM drej_events
        ${whereClause}
        GROUP BY wf_name, run_id
      )
      SELECT * FROM agg WHERE started_at IS NOT NULL ORDER BY started_at DESC`,
      params,
    );
  }

  async listRunDetails(workflowName: string, opts?: ListRunsOptions): Promise<RunDetails[]> {
    const rows = await this._aggQuery("WHERE wf_name = $1", [workflowName]);
    return applyOpts(rows.map(aggRowToDetails), opts);
  }

  async listAllRunDetails(opts?: ListRunsOptions): Promise<RunDetails[]> {
    const rows = await this._aggQuery("", []);
    return applyOpts(rows.map(aggRowToDetails), opts);
  }

  async getRunDetails(workflowName: string, runId: string): Promise<RunDetails | null> {
    const rows = await this._aggQuery("WHERE wf_name = $1 AND run_id = $2", [workflowName, runId]);
    return rows.length ? aggRowToDetails(rows[0]) : null;
  }

  async deleteRun(workflowName: string, runId: string): Promise<void> {
    await this.sql`DELETE FROM drej_events WHERE wf_name = ${workflowName} AND run_id = ${runId}`;
  }
}
