import { LedgerEvent, type IStorageAdapter, type LedgerEntry, type WorkflowDeps } from "@drej/core";
import { describe, expect, it, vi } from "vitest";
import { makeStream } from "../src/stream.ts";

function makeAdapter(): IStorageAdapter {
  return {
    append: vi.fn().mockResolvedValue(undefined),
    readAll: vi.fn().mockResolvedValue([]),
    lastCheckpoint: vi.fn().mockResolvedValue(null),
    listRunDetails: vi.fn().mockResolvedValue([]),
    listAllRunDetails: vi.fn().mockResolvedValue([]),
    getRunDetails: vi.fn().mockResolvedValue(null),
    deleteRun: vi.fn().mockResolvedValue(undefined),
  };
}

const fakeControl = {} as any;

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

describe("makeStream", () => {
  it("yields a RunStarted event immediately", async () => {
    const stream = makeStream("wf", "run-1", makeAdapter(), fakeControl, async () => {});
    const events = await collect(stream);
    expect(events[0]).toMatchObject({ event: LedgerEvent.RunStarted, workflowName: "wf", runId: "run-1" });
  });

  it("yields events appended via the tee adapter", async () => {
    const execute = async (deps: WorkflowDeps) => {
      await deps.adapter.append({
        ts: 1000,
        workflowName: "wf",
        runId: "run-1",
        stepIndex: 0,
        event: LedgerEvent.StepStart,
      });
      await deps.adapter.append({
        ts: 2000,
        workflowName: "wf",
        runId: "run-1",
        stepIndex: 0,
        event: LedgerEvent.StepComplete,
      });
    };

    const events = await collect(makeStream("wf", "run-1", makeAdapter(), fakeControl, execute));
    const eventTypes = events.map((e) => (e as LedgerEntry).event);
    expect(eventTypes).toContain(LedgerEvent.StepStart);
    expect(eventTypes).toContain(LedgerEvent.StepComplete);
  });

  it("persists events to the underlying adapter", async () => {
    const adapter = makeAdapter();
    const execute = async (deps: WorkflowDeps) => {
      await deps.adapter.append({
        ts: 1000,
        workflowName: "wf",
        runId: "run-1",
        stepIndex: 0,
        event: LedgerEvent.StepStart,
      });
    };

    await collect(makeStream("wf", "run-1", adapter, fakeControl, execute));
    expect(adapter.append).toHaveBeenCalledWith(expect.objectContaining({ event: LedgerEvent.StepStart }));
  });

  it("terminates after execute resolves with no more events", async () => {
    const events = await collect(makeStream("wf", "run-1", makeAdapter(), fakeControl, async () => {}));
    // Only the initial RunStarted
    expect(events).toHaveLength(1);
  });

  it("propagates errors thrown by execute", async () => {
    const execute = async () => { throw new Error("boom"); };
    await expect(collect(makeStream("wf", "run-1", makeAdapter(), fakeControl, execute))).rejects.toThrow("boom");
  });

  it("still yields buffered events before propagating the error", async () => {
    const execute = async (deps: WorkflowDeps) => {
      await deps.adapter.append({
        ts: 1000,
        workflowName: "wf",
        runId: "run-1",
        stepIndex: 0,
        event: LedgerEvent.StepStart,
      });
      throw new Error("fail after event");
    };

    const events: LedgerEntry[] = [];
    const stream = makeStream("wf", "run-1", makeAdapter(), fakeControl, execute);
    await expect(async () => {
      for await (const e of stream) events.push(e as LedgerEntry);
    }).rejects.toThrow("fail after event");

    expect(events.some((e) => e.event === LedgerEvent.StepStart)).toBe(true);
  });

  it("includes name and runId on the RunStarted event", async () => {
    const events = await collect(makeStream("deploy", "abc-123", makeAdapter(), fakeControl, async () => {}));
    expect(events[0]).toMatchObject({ workflowName: "deploy", runId: "abc-123", stepIndex: -1 });
  });
});
