import { LedgerEvent } from "../ledger";
import type { WorkflowRunContext, WorkflowStep } from "../workflow";
import { StepType, Backoff, type StepDef, type WorkflowState } from "./types";
import { evaluate, getPath, runWithConcurrency } from "./utils";

type BuildStepFn = (def: StepDef) => WorkflowStep;

export function buildRetryStep(
  def: Extract<StepDef, { type: StepType.Retry }>,
  buildStepFn: BuildStepFn,
): WorkflowStep {
  const child = buildStepFn(def.step);
  return {
    id: StepType.Retry,
    rollback: child.rollback,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      let lastErr: unknown;
      for (let attempt = 0; attempt < def.maxAttempts; attempt++) {
        try {
          return await child.run(input, ctx);
        } catch (err) {
          lastErr = err;
          if (attempt < def.maxAttempts - 1) {
            const base = def.delayMs ?? 500;
            const delay = def.backoff === Backoff.Exponential ? base * Math.pow(2, attempt) : base;
            await ctx.emit({
              ts: Date.now(),
              workflowName: ctx.workflowName,
              runId: ctx.runId,
              stepIndex: ctx.stepIndex,
              event: LedgerEvent.ExecEvent,
              payload: { type: "retry_attempt", attempt: attempt + 1, maxAttempts: def.maxAttempts, error: String(err) },
            });
            await new Promise<void>((r) => setTimeout(r, delay));
          }
        }
      }
      throw lastErr;
    },
  };
}

export function buildConditionalStep(
  def: Extract<StepDef, { type: StepType.Conditional }>,
  buildStepFn: BuildStepFn,
): WorkflowStep {
  const thenSteps = def.then.map(buildStepFn);
  const elseSteps = (def.else ?? []).map(buildStepFn);
  return {
    id: StepType.Conditional,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const branch = evaluate(def.condition, input) ? thenSteps : elseSteps;
      let current = input;
      for (const step of branch) {
        current = await step.run(current, ctx);
      }
      return current;
    },
  };
}

export function buildLoopStep(
  def: Extract<StepDef, { type: StepType.Loop }>,
  buildStepFn: BuildStepFn,
): WorkflowStep {
  return {
    id: StepType.Loop,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const arr = def.items ?? (def.over ? getPath(input, def.over) : undefined);
      if (!Array.isArray(arr)) throw new Error(`loop: must provide either "items" or "over" pointing to an array in workflow state`);

      const runIteration = async (item: unknown, index: number): Promise<unknown> => {
        const iterState = { ...(input as WorkflowState), [def.as]: item, loopIndex: index };
        let current: unknown = iterState;
        for (const step of def.steps.map(buildStepFn)) {
          current = await step.run(current, ctx);
        }
        return current;
      };

      const max = def.maxConcurrency ?? 1;
      const tasks = arr.map((item, i) => () => runIteration(item, i));
      const loopResults = max === 1
        ? await tasks.reduce<Promise<unknown[]>>(async (accP, t) => { const acc = await accP; acc.push(await t()); return acc; }, Promise.resolve([]))
        : await runWithConcurrency(tasks, max);

      return { ...(input as WorkflowState), loopResults };
    },
  };
}

export function buildParallelStep(
  def: Extract<StepDef, { type: StepType.Parallel }>,
  buildStepFn: BuildStepFn,
): WorkflowStep {
  return {
    id: StepType.Parallel,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const branchedTasks = def.steps.map((stepDef, branchIndex) => {
        const branchCtx: WorkflowRunContext = {
          ...ctx,
          stepIndex: ctx.stepIndex * 1000 + branchIndex,
          emit: (entry) => ctx.emit({ ...entry, branch: branchIndex }),
        };
        return () => buildStepFn(stepDef).run(input, branchCtx);
      });
      const results = def.maxConcurrency
        ? await runWithConcurrency(branchedTasks, def.maxConcurrency)
        : await Promise.all(branchedTasks.map((t) => t()));

      const merged = results.reduce<WorkflowState>(
        (acc, result) => ({ ...acc, ...(result as WorkflowState) }),
        input as WorkflowState,
      );
      return { ...merged, parallelResults: results };
    },
  };
}

export function buildSequenceStep(
  def: Extract<StepDef, { type: StepType.Sequence }>,
  buildStepFn: BuildStepFn,
): WorkflowStep {
  const childSteps = def.steps.map(buildStepFn);
  return {
    id: StepType.Sequence,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      let current = input;
      for (const step of childSteps) {
        current = await step.run(current, ctx);
      }
      return current;
    },
    async rollback(input: unknown, ctx: WorkflowRunContext): Promise<void> {
      for (const step of [...childSteps].reverse()) {
        if (step.rollback) await step.rollback(input, ctx);
      }
    },
  };
}
