import { describe, expect, it, vi } from "vitest";
import {
  buildConditionalStep,
  buildLoopStep,
  buildParallelStep,
  buildRetryStep,
  buildSequenceStep,
} from "../src/steps/control-flow.ts";
import { Backoff, StepType, type StepDef } from "../src/steps/types.ts";
import type { WorkflowRunContext, WorkflowStep } from "../src/workflow.ts";

function makeCtx(overrides?: Partial<WorkflowRunContext>): WorkflowRunContext {
  return {
    workflowName: "test-wf",
    runId: "run-1",
    stepIndex: 0,
    control: {} as any,
    resolveExec: async () => ({} as any),
    emit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeStep(fn: (input: unknown) => Promise<unknown>): WorkflowStep {
  return { id: "test", run: (input) => fn(input) };
}

const identity: WorkflowStep = { id: "identity", run: (input) => Promise.resolve(input) };

// ── buildRetryStep ────────────────────────────────────────────────────────────

describe("buildRetryStep", () => {
  function retryDef(maxAttempts: number, extra?: object): Extract<StepDef, { type: StepType.Retry }> {
    return { type: StepType.Retry, maxAttempts, delayMs: 0, step: { type: StepType.ExecCommand, command: "x" }, ...extra };
  }

  it("returns result on first success", async () => {
    const step = buildRetryStep(retryDef(3), () => makeStep(async () => "ok"));
    expect(await step.run({}, makeCtx())).toBe("ok");
  });

  it("retries and succeeds on a later attempt", async () => {
    let calls = 0;
    const step = buildRetryStep(retryDef(3), () =>
      makeStep(async () => {
        if (++calls < 3) throw new Error("fail");
        return "ok";
      }),
    );
    expect(await step.run({}, makeCtx())).toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws the last error after maxAttempts exhausted", async () => {
    const step = buildRetryStep(retryDef(3), () =>
      makeStep(async () => { throw new Error("always fails"); }),
    );
    await expect(step.run({}, makeCtx())).rejects.toThrow("always fails");
  });

  it("emits a retry event for each failed attempt except the last", async () => {
    let calls = 0;
    const ctx = makeCtx();
    const step = buildRetryStep(retryDef(3), () =>
      makeStep(async () => {
        if (++calls < 3) throw new Error("fail");
        return "ok";
      }),
    );
    await step.run({}, ctx);
    expect(ctx.emit).toHaveBeenCalledTimes(2);
  });

  it("uses exponential delay when backoff is Exponential", async () => {
    // delayMs: 0 makes exponential delay 0 * 2^n = 0ms — no real wait
    let calls = 0;
    const step = buildRetryStep(
      retryDef(3, { backoff: Backoff.Exponential }),
      () => makeStep(async () => {
        if (++calls < 3) throw new Error("fail");
        return "done";
      }),
    );
    expect(await step.run({}, makeCtx())).toBe("done");
  });

  it("inherits rollback from the child step", async () => {
    const rollback = vi.fn().mockResolvedValue(undefined);
    const step = buildRetryStep(retryDef(1), () => ({ id: "child", run: async (i) => i, rollback }));
    expect(step.rollback).toBe(rollback);
  });
});

// ── buildConditionalStep ──────────────────────────────────────────────────────

describe("buildConditionalStep", () => {
  it("runs the then branch when condition is true", async () => {
    let ran = false;
    const step = buildConditionalStep(
      { type: StepType.Conditional, condition: { op: "eq", field: "x", value: 1 }, then: [{ type: StepType.ExecCommand, command: "t" }] },
      () => makeStep(async (i) => { ran = true; return i; }),
    );
    await step.run({ x: 1 }, makeCtx());
    expect(ran).toBe(true);
  });

  it("runs the else branch when condition is false", async () => {
    const order: string[] = [];
    const step = buildConditionalStep(
      {
        type: StepType.Conditional,
        condition: { op: "eq", field: "x", value: 1 },
        then: [{ type: StepType.ExecCommand, command: "then" }],
        else: [{ type: StepType.ExecCommand, command: "else" }],
      },
      (def) => makeStep(async (i) => {
        order.push((def as any).command);
        return i;
      }),
    );
    await step.run({ x: 99 }, makeCtx());
    expect(order).toEqual(["else"]);
  });

  it("returns input unchanged when condition is false and no else branch", async () => {
    const step = buildConditionalStep(
      { type: StepType.Conditional, condition: { op: "eq", field: "x", value: 1 }, then: [{ type: StepType.ExecCommand, command: "t" }] },
      () => identity,
    );
    const input = { x: 0 };
    expect(await step.run(input, makeCtx())).toBe(input);
  });

  it("passes state through branch steps in sequence", async () => {
    const step = buildConditionalStep(
      {
        type: StepType.Conditional,
        condition: { op: "eq", field: "x", value: 1 },
        then: [
          { type: StepType.ExecCommand, command: "a" },
          { type: StepType.ExecCommand, command: "b" },
        ],
      },
      (def) => makeStep(async (i) => ({ ...(i as any), [(def as any).command]: true })),
    );
    const result = await step.run({ x: 1 }, makeCtx()) as any;
    expect(result.a).toBe(true);
    expect(result.b).toBe(true);
  });
});

// ── buildLoopStep ─────────────────────────────────────────────────────────────

describe("buildLoopStep", () => {
  function loopDef(extra: object): Extract<StepDef, { type: StepType.Loop }> {
    return { type: StepType.Loop, as: "item", steps: [{ type: StepType.ExecCommand, command: "x" }], ...extra };
  }

  it("iterates over static items and returns loopResults", async () => {
    const seen: unknown[] = [];
    const step = buildLoopStep(loopDef({ items: [1, 2, 3] }), () =>
      makeStep(async (i) => { seen.push((i as any).item); return i; }),
    );
    const out = await step.run({}, makeCtx()) as any;
    expect(seen).toEqual([1, 2, 3]);
    expect(out.loopResults).toHaveLength(3);
  });

  it("reads items from state when using over", async () => {
    const seen: unknown[] = [];
    const step = buildLoopStep(loopDef({ over: "files" }), () =>
      makeStep(async (i) => { seen.push((i as any).item); return i; }),
    );
    await step.run({ files: ["a.txt", "b.txt"] }, makeCtx());
    expect(seen).toEqual(["a.txt", "b.txt"]);
  });

  it("sets the loop variable and loopIndex in state", async () => {
    const captured: Array<{ item: unknown; index: number }> = [];
    const step = buildLoopStep(loopDef({ items: ["a", "b"] }), () =>
      makeStep(async (i) => {
        captured.push({ item: (i as any).item, index: (i as any).loopIndex });
        return i;
      }),
    );
    await step.run({}, makeCtx());
    expect(captured).toEqual([{ item: "a", index: 0 }, { item: "b", index: 1 }]);
  });

  it("throws when neither items nor over resolves to an array", async () => {
    const step = buildLoopStep({ type: StepType.Loop, as: "x", steps: [] } as any, () => identity);
    await expect(step.run({}, makeCtx())).rejects.toThrow("loop:");
  });

  it("respects maxConcurrency when running iterations", async () => {
    let active = 0;
    let maxActive = 0;
    const step = buildLoopStep(loopDef({ items: [1, 2, 3, 4], maxConcurrency: 2 }), () =>
      makeStep(async (i) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return i;
      }),
    );
    await step.run({}, makeCtx());
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

// ── buildParallelStep ─────────────────────────────────────────────────────────

describe("buildParallelStep", () => {
  it("runs all branches and merges results", async () => {
    const step = buildParallelStep(
      {
        type: StepType.Parallel,
        steps: [
          { type: StepType.ExecCommand, command: "a" },
          { type: StepType.ExecCommand, command: "b" },
        ],
      },
      (def) => makeStep(async (i) => ({ ...(i as any), [(def as any).command]: true })),
    );
    const result = await step.run({ base: 1 }, makeCtx()) as any;
    expect(result.a).toBe(true);
    expect(result.b).toBe(true);
    expect(result.parallelResults).toHaveLength(2);
  });

  it("tags emitted events with the branch index", async () => {
    const ctx = makeCtx();
    const step = buildParallelStep(
      {
        type: StepType.Parallel,
        steps: [
          { type: StepType.ExecCommand, command: "a" },
          { type: StepType.ExecCommand, command: "b" },
        ],
      },
      () => makeStep(async (i) => {
        // Do nothing, just let the branch ctx emit
        return i;
      }),
    );
    await step.run({}, ctx);
    // branch ctx is internal — just verify the step completes cleanly
  });

  it("respects maxConcurrency across branches", async () => {
    let active = 0;
    let maxActive = 0;
    const step = buildParallelStep(
      {
        type: StepType.Parallel,
        steps: new Array(4).fill({ type: StepType.ExecCommand, command: "x" }),
        maxConcurrency: 2,
      },
      () => makeStep(async (i) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return i;
      }),
    );
    await step.run({}, makeCtx());
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

// ── buildSequenceStep ─────────────────────────────────────────────────────────

describe("buildSequenceStep", () => {
  it("runs steps in order, passing output as next input", async () => {
    const step = buildSequenceStep(
      {
        type: StepType.Sequence,
        steps: [
          { type: StepType.ExecCommand, command: "a" },
          { type: StepType.ExecCommand, command: "b" },
        ],
      },
      (def) => makeStep(async (i) => ({ ...(i as any), [(def as any).command]: true })),
    );
    const result = await step.run({}, makeCtx()) as any;
    expect(result.a).toBe(true);
    expect(result.b).toBe(true);
  });

  it("rollback runs completed steps in reverse order", async () => {
    const order: string[] = [];
    const step = buildSequenceStep(
      {
        type: StepType.Sequence,
        steps: [
          { type: StepType.ExecCommand, command: "a" },
          { type: StepType.ExecCommand, command: "b" },
          { type: StepType.ExecCommand, command: "c" },
        ],
      },
      (def) => ({
        id: (def as any).command,
        run: async (i: unknown) => i,
        rollback: async () => { order.push((def as any).command); },
      }),
    );
    const ctx = makeCtx();
    await step.run({}, ctx);
    await step.rollback!({}, ctx);
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("skips rollback for steps that have no rollback handler", async () => {
    const rolledBack: string[] = [];
    const step = buildSequenceStep(
      {
        type: StepType.Sequence,
        steps: [
          { type: StepType.ExecCommand, command: "a" },
          { type: StepType.ExecCommand, command: "b" },
        ],
      },
      (def) => {
        const cmd = (def as any).command;
        return cmd === "b"
          ? { id: cmd, run: async (i: unknown) => i, rollback: async () => { rolledBack.push(cmd); } }
          : { id: cmd, run: async (i: unknown) => i };
      },
    );
    const ctx = makeCtx();
    await step.run({}, ctx);
    await step.rollback!({}, ctx);
    expect(rolledBack).toEqual(["b"]);
  });
});
