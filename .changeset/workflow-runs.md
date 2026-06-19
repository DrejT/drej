---
"drej": minor
---

Introduce per-run ledger with workflow name / run ID separation.

Each workflow execution now has a stable **workflow name** (user-defined) and an auto-generated **run ID** (UUID). Ledger files are stored at `ledgers/<name>/<runId>.ndjson` so all runs of a workflow are grouped together.

API changes:
- `POST /v1/workflows/:name/runs` — starts a run; first SSE event is `run_started` carrying the run ID
- `POST /v1/workflows/:name/runs/:runId/resume` — resumes a specific run
- `GET /v1/workflows/:name/runs` — lists all run IDs for a workflow
- `GET /v1/workflows/:name/runs/:runId/ledger` — fetches ledger for a specific run

SDK changes:
- `client.run(w)` is now `async` and returns `Promise<WorkflowRun>`; `run.id` gives the run ID, `run.name` the workflow name, and it is async-iterable for events
- `client.resumeRun(name, runId, w)` resumes a run
- `client.listWorkflowRuns(name)` lists runs
- `client.getWorkflowLedger(name, runId)` fetches the ledger
- `WorkflowEvent` fields renamed: `workflowId` → `workflowName` + `runId`
