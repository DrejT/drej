# Run Management API

## Problem

The current `DrejClient` has two run-inspection methods:

| Method | Returns | Gap |
|---|---|---|
| `listRuns(workflowName)` | `string[]` (bare IDs) | no status, timestamps, or step count |
| `getRunLedger(workflowName, runId)` | `LedgerEntry[]` (all raw events) | caller must derive everything |

There is no way to:
- Know if a run succeeded, failed, or is still running without reading every event
- List runs across all workflows
- Delete a completed run from storage
- Cancel an in-flight run

`WorkflowRun` (the object returned by `client.run()`) also exposes no introspection beyond `id` and `name`.

---

## Phase 1 — Summaries, Listing, and Deletion

### 1.1 New types in `@drej/core`

Add to `packages/core/src/ledger.ts`:

```ts
export enum RunStatus {
  Running   = "running",
  Completed = "completed",
  Failed    = "failed",
  Cancelled = "cancelled",
}

export interface RunSummary {
  workflowName: string;
  runId: string;
  status: RunStatus;
  startedAt: number;    // ts of run_started event
  completedAt?: number; // ts of workflow_complete / workflow_failed / workflow_cancelled
  stepCount: number;    // number of step_complete events
  error?: string;       // message from workflow_failed, if any
}

export interface ListRunsOptions {
  status?: RunStatus;
  limit?: number;
  before?: number; // timestamp cursor — return only runs started before this ts
}
```

Export all three from `packages/core/src/index.ts` and re-export from `packages/sdks/typescript/src/client.ts`.

### 1.2 `IStorageAdapter` additions

Extend the interface in `packages/core/src/ledger.ts`:

```ts
export interface IStorageAdapter {
  // ... existing methods unchanged ...

  /** Return summaries for all runs of a specific workflow. */
  listRunSummaries(workflowName: string, opts?: ListRunsOptions): Promise<RunSummary[]>;

  /** Return summaries across all workflows. */
  listAllRunSummaries(opts?: ListRunsOptions): Promise<RunSummary[]>;

  /** Delete all ledger events for a run. */
  deleteRun(workflowName: string, runId: string): Promise<void>;
}
```

`listRuns(workflowName)` stays untouched for backward compatibility.

### 1.3 SQLite implementation

Add to `packages/adapters/sqlite/src/adapter.ts`.

The key insight: all three summary fields can be derived from a single aggregated SQL query rather than loading every row:

```sql
SELECT
  wf_name,
  run_id,
  MIN(CASE WHEN event = 'run_started'        THEN ts END) AS started_at,
  MAX(CASE WHEN event IN ('workflow_complete','workflow_failed','workflow_cancelled')
                                              THEN ts END) AS completed_at,
  MAX(CASE WHEN event IN ('workflow_complete','workflow_failed','workflow_cancelled')
                                              THEN event END) AS terminal_event,
  MAX(CASE WHEN event = 'workflow_failed'    THEN error END) AS error,
  COUNT(CASE WHEN event = 'step_complete'    THEN 1 END) AS step_count
FROM drej_events
WHERE wf_name = ?          -- omit for listAllRunSummaries
  AND (? IS NULL OR ts < ?) -- before cursor
GROUP BY wf_name, run_id
HAVING started_at IS NOT NULL
ORDER BY started_at DESC
LIMIT ?
```

Map `terminal_event` → `RunStatus`:
- `workflow_complete` → `Completed`
- `workflow_failed` → `Failed`
- `workflow_cancelled` → `Cancelled`
- `null` → `Running`

Apply `status` filter in application code after mapping (SQLite doesn't have CASE in HAVING easily), or use a subquery.

For `deleteRun`:
```sql
DELETE FROM drej_events WHERE wf_name = ? AND run_id = ?
```

### 1.4 Postgres implementation

Same logic in `packages/adapters/postgres/src/adapter.ts`, using `$1`-style params and `pg` pool.

The aggregation query translates directly. Postgres supports filtering on computed columns via CTEs if needed:

```sql
WITH summaries AS (
  SELECT
    wf_name, run_id,
    MIN(CASE WHEN event = 'run_started' THEN ts END) AS started_at,
    ...
  FROM drej_events
  WHERE ($1::text IS NULL OR wf_name = $1)
  GROUP BY wf_name, run_id
)
SELECT * FROM summaries
WHERE started_at IS NOT NULL
  AND ($2::text IS NULL OR status = $2)
ORDER BY started_at DESC
LIMIT $3
```

### 1.5 `DrejClient` new methods

Add to `packages/sdks/typescript/src/client.ts`:

```ts
/** Return summaries for runs of a specific workflow. */
listRunSummaries(workflowName: string, opts?: ListRunsOptions): Promise<RunSummary[]> {
  return this.adapter.listRunSummaries(workflowName, opts);
}

/** Return summaries across all workflows. */
listAllRunSummaries(opts?: ListRunsOptions): Promise<RunSummary[]> {
  return this.adapter.listAllRunSummaries(opts);
}

/** Return a summary for a single run. Throws if the run does not exist. */
async getRunSummary(workflowName: string, runId: string): Promise<RunSummary> {
  const [summary] = await this.adapter.listRunSummaries(workflowName, { limit: 1 });
  // filter by runId — or add a dedicated adapter method if perf matters later
  const match = (await this.adapter.listRunSummaries(workflowName)).find(s => s.runId === runId);
  if (!match) throw new DrejError(`Run ${runId} not found`, 404);
  return match;
}

/** Delete all ledger events for a run. The run must have already completed. */
deleteRun(workflowName: string, runId: string): Promise<void> {
  return this.adapter.deleteRun(workflowName, runId);
}
```

> Note: `getRunSummary` is a convenience wrapper; a `getSingleRunSummary(wfName, runId)` adapter method would be more efficient but can be added later.

### 1.6 `WorkflowRun.status` property

Currently `WorkflowRun` only holds `name`, `id`, and the async generator. Add a `status` getter that tracks state as the generator is consumed:

```ts
export class WorkflowRun implements AsyncIterable<WorkflowEvent> {
  private _status: RunStatus = RunStatus.Running;

  get status(): RunStatus { return this._status; }

  [Symbol.asyncIterator](): AsyncIterator<WorkflowEvent> {
    const gen = this._events;
    const self = this;
    return {
      async next() {
        const result = await gen.next();
        if (result.done) {
          // _makeStream throws executionError on failure, so reaching here = completed
          self._status = RunStatus.Completed;
        }
        return result;
      },
      async return(value) {
        self._status = RunStatus.Cancelled;
        return gen.return?.(value) ?? { done: true, value };
      },
      async throw(e) {
        self._status = RunStatus.Failed;
        return gen.throw?.(e) ?? { done: true, value: undefined };
      }
    };
  }
}
```

The generator already throws on workflow failure (via `executionError`), so catching that in `throw` is correct.

---

## Phase 2 — Cancellation

Cancellation of an in-flight `WorkflowRun` requires stopping the underlying OpenSandbox calls mid-execution. Design:

### Approach: in-memory AbortController registry

1. `DrejClient` keeps `private readonly _runs = new Map<string, AbortController>()`.
2. When `_execute` is called, it creates an `AbortController`, stores it under `runId`, and passes `signal` into `WorkflowDeps`.
3. The `Workflow` step-runner checks `signal.aborted` before starting each step and throws `DrejCancelledError` if aborted.
4. On abort, a `LedgerEvent.WorkflowCancelled` entry is written.
5. `cancelRun(workflowName, runId)` calls `controller.abort()`.
6. After the generator is exhausted, the controller is removed from the map.

```ts
async cancelRun(workflowName: string, runId: string): Promise<void> {
  const controller = this._runs.get(runId);
  if (!controller) throw new DrejError(`No in-flight run ${runId}`, 404);
  controller.abort();
}
```

### New ledger event

Add `WorkflowCancelled = "workflow_cancelled"` to `LedgerEvent`. The `RunStatus.Cancelled` mapping already accounts for this.

### Core engine change

In `packages/core/src/workflow.ts`, `Workflow.run()` accepts an optional `AbortSignal` through `WorkflowDeps`:

```ts
export interface WorkflowDeps {
  // ... existing ...
  signal?: AbortSignal;
}
```

Before each step execution:
```ts
if (deps.signal?.aborted) {
  await this._emitCancelled();
  throw new WorkflowCancelledError(this.name, this.runId);
}
```

---

## Implementation Order

1. `RunStatus`, `RunSummary`, `ListRunsOptions` in `@drej/core` + exports
2. `IStorageAdapter` interface additions
3. SQLite adapter implementation
4. Postgres adapter implementation
5. `DrejClient` new methods + `WorkflowRun.status`
6. (Phase 2) Cancellation: `AbortController` registry + `Workflow` signal check + `WorkflowCancelled` event

Each step is independently shippable. Steps 1–5 can ship in one PR; step 6 in a follow-up.

---

## Non-goals

- HTTP API / admin dashboard — drej is in-process; observability is the user's responsibility (use `@drej/otel` + Grafana)
- Pagination tokens beyond `before` (timestamp cursor) — sufficient for initial release
- Searching ledger content (e.g. step output) — that's a full-text search problem; out of scope
