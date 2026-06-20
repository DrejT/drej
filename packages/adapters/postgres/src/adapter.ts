import postgres from "postgres";
import type { IStorageAdapter, LedgerEntry, LedgerEvent } from "@drej/core";
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

  async listRuns(workflowName: string): Promise<string[]> {
    const rows = await this.sql<{ run_id: string }[]>`
      SELECT DISTINCT run_id FROM drej_events WHERE wf_name = ${workflowName}
    `;
    return rows.map((r) => r.run_id);
  }
}
