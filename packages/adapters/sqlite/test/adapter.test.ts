import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { LedgerEvent, RunStatus, type LedgerEntry } from "@drej/core";
import { SQLiteAdapter } from "../src/adapter.ts";

function entry(overrides?: Partial<LedgerEntry>): LedgerEntry {
  return {
    ts: Date.now(),
    workflowName: "test-wf",
    runId: "run-1",
    stepIndex: 0,
    event: LedgerEvent.StepStart,
    ...overrides,
  };
}

describe("SQLiteAdapter", () => {
  let db: SQLiteAdapter;

  beforeEach(async () => {
    db = new SQLiteAdapter(":memory:");
    await db.connect();
  });

  afterEach(async () => {
    await db.close();
  });

  // ── append / readAll ────────────────────────────────────────────────────────

  describe("append / readAll", () => {
    it("stores and retrieves an entry", async () => {
      await db.append(entry({ event: LedgerEvent.StepStart }));
      const rows = await db.readAll("test-wf", "run-1");
      expect(rows).toHaveLength(1);
      expect(rows[0].event).toBe(LedgerEvent.StepStart);
    });

    it("returns entries in ascending timestamp order", async () => {
      await db.append(entry({ ts: 2000, event: LedgerEvent.StepComplete }));
      await db.append(entry({ ts: 1000, event: LedgerEvent.StepStart }));
      const rows = await db.readAll("test-wf", "run-1");
      expect(rows[0].ts).toBe(1000);
      expect(rows[1].ts).toBe(2000);
    });

    it("scopes to the given workflow name and run id", async () => {
      await db.append(entry({ workflowName: "wf-a", runId: "r1" }));
      await db.append(entry({ workflowName: "wf-b", runId: "r2" }));
      expect(await db.readAll("wf-a", "r1")).toHaveLength(1);
      expect(await db.readAll("wf-b", "r2")).toHaveLength(1);
      expect(await db.readAll("wf-a", "r2")).toHaveLength(0);
    });

    it("serialises and deserialises JSON payload", async () => {
      await db.append(entry({ payload: { key: "value", n: 42 } }));
      const rows = await db.readAll("test-wf", "run-1");
      expect(rows[0].payload).toEqual({ key: "value", n: 42 });
    });

    it("preserves null payload as undefined", async () => {
      await db.append(entry({ payload: undefined }));
      const rows = await db.readAll("test-wf", "run-1");
      expect(rows[0].payload).toBeUndefined();
    });

    it("preserves the branch field", async () => {
      await db.append(entry({ branch: 2 }));
      const rows = await db.readAll("test-wf", "run-1");
      expect(rows[0].branch).toBe(2);
    });

    it("returns undefined branch when not set", async () => {
      await db.append(entry());
      const rows = await db.readAll("test-wf", "run-1");
      expect(rows[0].branch).toBeUndefined();
    });
  });

  // ── lastCheckpoint ──────────────────────────────────────────────────────────

  describe("lastCheckpoint", () => {
    it("returns null when no checkpoint exists", async () => {
      expect(await db.lastCheckpoint("test-wf", "run-1")).toBeNull();
    });

    it("returns the most recent checkpoint", async () => {
      await db.append(entry({ ts: 1000, event: LedgerEvent.Checkpoint, payload: { step: 1 } }));
      await db.append(entry({ ts: 2000, event: LedgerEvent.Checkpoint, payload: { step: 2 } }));
      const cp = await db.lastCheckpoint("test-wf", "run-1");
      expect((cp!.payload as any).step).toBe(2);
    });

    it("ignores non-checkpoint events", async () => {
      await db.append(entry({ event: LedgerEvent.StepStart }));
      expect(await db.lastCheckpoint("test-wf", "run-1")).toBeNull();
    });
  });

  // ── run details ─────────────────────────────────────────────────────────────

  async function seedRun(wf: string, runId: string, terminal: LedgerEvent.WorkflowComplete | LedgerEvent.WorkflowFailed, error?: string) {
    const ts = Date.now();
    await db.append(entry({ workflowName: wf, runId, ts, stepIndex: -1, event: LedgerEvent.RunStarted }));
    await db.append(entry({ workflowName: wf, runId, ts: ts + 1, stepIndex: 0, event: LedgerEvent.StepComplete }));
    await db.append(entry({ workflowName: wf, runId, ts: ts + 2, stepIndex: -1, event: terminal, error }));
  }

  describe("getRunDetails", () => {
    it("returns null for an unknown run", async () => {
      expect(await db.getRunDetails("wf", "no-such-run")).toBeNull();
    });

    it("returns Completed status", async () => {
      await seedRun("wf", "run-1", LedgerEvent.WorkflowComplete);
      const d = await db.getRunDetails("wf", "run-1");
      expect(d?.status).toBe(RunStatus.Completed);
      expect(d?.stepCount).toBe(1);
    });

    it("returns Failed status with error message", async () => {
      await seedRun("wf", "run-1", LedgerEvent.WorkflowFailed, "boom");
      const d = await db.getRunDetails("wf", "run-1");
      expect(d?.status).toBe(RunStatus.Failed);
      expect(d?.error).toBe("boom");
    });

    it("returns Running when no terminal event present", async () => {
      await db.append(entry({ stepIndex: -1, event: LedgerEvent.RunStarted }));
      const d = await db.getRunDetails("test-wf", "run-1");
      expect(d?.status).toBe(RunStatus.Running);
    });
  });

  describe("listRunDetails", () => {
    it("scopes to a single workflow", async () => {
      await seedRun("wf-a", "r1", LedgerEvent.WorkflowComplete);
      await seedRun("wf-b", "r2", LedgerEvent.WorkflowComplete);
      const results = await db.listRunDetails("wf-a");
      expect(results).toHaveLength(1);
      expect(results[0].workflowName).toBe("wf-a");
    });

    it("filters by status", async () => {
      await seedRun("wf", "r1", LedgerEvent.WorkflowComplete);
      await seedRun("wf", "r2", LedgerEvent.WorkflowFailed);
      const completed = await db.listRunDetails("wf", { status: RunStatus.Completed });
      expect(completed).toHaveLength(1);
      expect(completed[0].runId).toBe("r1");
    });

    it("respects the limit option", async () => {
      await seedRun("wf", "r1", LedgerEvent.WorkflowComplete);
      await seedRun("wf", "r2", LedgerEvent.WorkflowComplete);
      expect(await db.listRunDetails("wf", { limit: 1 })).toHaveLength(1);
    });
  });

  describe("listAllRunDetails", () => {
    it("returns runs across all workflows", async () => {
      await seedRun("wf-a", "r1", LedgerEvent.WorkflowComplete);
      await seedRun("wf-b", "r2", LedgerEvent.WorkflowComplete);
      expect(await db.listAllRunDetails()).toHaveLength(2);
    });

    it("filters by status across workflows", async () => {
      await seedRun("wf-a", "r1", LedgerEvent.WorkflowComplete);
      await seedRun("wf-b", "r2", LedgerEvent.WorkflowFailed);
      const failed = await db.listAllRunDetails({ status: RunStatus.Failed });
      expect(failed).toHaveLength(1);
      expect(failed[0].workflowName).toBe("wf-b");
    });
  });

  describe("deleteRun", () => {
    it("removes all entries for the run", async () => {
      await seedRun("wf", "run-1", LedgerEvent.WorkflowComplete);
      await db.deleteRun("wf", "run-1");
      expect(await db.readAll("wf", "run-1")).toHaveLength(0);
      expect(await db.getRunDetails("wf", "run-1")).toBeNull();
    });

    it("does not affect other runs", async () => {
      await seedRun("wf", "r1", LedgerEvent.WorkflowComplete);
      await seedRun("wf", "r2", LedgerEvent.WorkflowComplete);
      await db.deleteRun("wf", "r1");
      expect(await db.getRunDetails("wf", "r2")).not.toBeNull();
    });
  });
});
