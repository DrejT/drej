import type { IStorageAdapter, LedgerEntry, WorkflowDeps } from "@drej/core";
import { LedgerEvent, resolveExecClient } from "@drej/core";
import type { ControlClient } from "@drej/opensandbox";
import type { WorkflowEvent } from "./types";

export function makeStream(
  name: string,
  runId: string,
  adapter: IStorageAdapter,
  control: ControlClient,
  execute: (deps: WorkflowDeps) => Promise<void>,
): AsyncGenerator<WorkflowEvent> {
  const queue: WorkflowEvent[] = [];
  let wakeup: (() => void) | null = null;
  let done = false;

  const enqueue = (entry: LedgerEntry) => {
    queue.push(entry);
    const fn = wakeup;
    wakeup = null;
    fn?.();
  };

  const teeAdapter: IStorageAdapter = {
    append: async (entry) => {
      await adapter.append(entry);
      enqueue(entry);
    },
    readAll: (n, id) => adapter.readAll(n, id),
    lastCheckpoint: (n, id) => adapter.lastCheckpoint(n, id),
    listRunDetails: (n, o) => adapter.listRunDetails(n, o),
    listAllRunDetails: (o) => adapter.listAllRunDetails(o),
    getRunDetails: (n, id) => adapter.getRunDetails(n, id),
    deleteRun: (n, id) => adapter.deleteRun(n, id),
  };

  const teeDeps: WorkflowDeps = {
    control,
    resolveExec: (sandboxId) => resolveExecClient(control, sandboxId),
    adapter: teeAdapter,
  };

  enqueue({ ts: Date.now(), workflowName: name, runId, stepIndex: -1, event: LedgerEvent.RunStarted, payload: { workflowName: name, runId } });

  let executionError: unknown = undefined;
  execute(teeDeps).then(
    () => { done = true; const fn = wakeup; wakeup = null; fn?.(); },
    (err) => { executionError = err; done = true; const fn = wakeup; wakeup = null; fn?.(); },
  );

  return (async function* () {
    while (true) {
      while (queue.length > 0) yield queue.shift()!;
      if (done) break;
      await new Promise<void>((r) => { wakeup = r; });
    }
    while (queue.length > 0) yield queue.shift()!;
    if (executionError !== undefined) throw executionError;
  })();
}
