import type { ILedger, LedgerEntry } from "./ledger";
import { LedgerEvent } from "./ledger";
import type { ISandboxControl, IExecClientFactory } from "./types";
import type { ILogger } from "./logger";
import { noopLogger } from "./logger";

export interface WorkflowRunContext {
  readonly workflowName: string;
  readonly runId: string;
  readonly stepIndex: number;
  readonly control: ISandboxControl;
  readonly execFactory: IExecClientFactory;
  emit(entry: LedgerEntry): Promise<void>;
}

export interface WorkflowStep {
  readonly id: string;
  run(input: unknown, ctx: WorkflowRunContext): Promise<unknown>;
  rollback?(output: unknown, ctx: WorkflowRunContext): Promise<void>;
}

export interface WorkflowCheckpoint {
  workflowName: string;
  runId: string;
  stepIndex: number;
  completedSteps: Record<number, { output: unknown; completedAt: number }>;
  timestamp: number;
}

export type WorkflowStatus = "idle" | "running" | "completed" | "failed" | "rolled_back";

export interface WorkflowDeps {
  control: ISandboxControl;
  execFactory: IExecClientFactory;
  ledger: ILedger;
  logger?: ILogger;
}

export class Workflow {
  readonly name: string;
  readonly runId: string;
  private _status: WorkflowStatus = "idle";
  private readonly completedSteps = new Map<number, { output: unknown; completedAt: number }>();
  private readonly log: ILogger;

  get status(): WorkflowStatus {
    return this._status;
  }

  constructor(
    name: string,
    runId: string,
    private readonly steps: WorkflowStep[],
    private readonly deps: WorkflowDeps,
  ) {
    this.name = name;
    this.runId = runId;
    this.log = deps.logger ?? noopLogger;
  }

  async run(input: unknown, startFromStep = 0): Promise<unknown> {
    this._status = "running";
    this.log.info("workflow started", { workflowName: this.name, runId: this.runId, startFromStep, totalSteps: this.steps.length });

    let current: unknown =
      startFromStep > 0 ? (this.completedSteps.get(startFromStep - 1)?.output ?? input) : input;

    for (let i = startFromStep; i < this.steps.length; i++) {
      const step = this.steps[i];
      const ctx = this.makeContext(i);

      this.log.debug("step starting", { workflowName: this.name, runId: this.runId, stepIndex: i, stepId: step.id });
      await ctx.emit({ ts: Date.now(), workflowName: this.name, runId: this.runId, stepIndex: i, event: LedgerEvent.StepStart });

      try {
        const output = await step.run(current, ctx);
        this.completedSteps.set(i, { output, completedAt: Date.now() });
        current = output;

        this.log.debug("step complete", { workflowName: this.name, runId: this.runId, stepIndex: i, stepId: step.id });
        await ctx.emit({
          ts: Date.now(),
          workflowName: this.name,
          runId: this.runId,
          stepIndex: i,
          event: LedgerEvent.StepComplete,
          payload: output,
        });

        await this.deps.ledger.append({
          ts: Date.now(),
          workflowName: this.name,
          runId: this.runId,
          stepIndex: i + 1,
          event: LedgerEvent.Checkpoint,
          payload: this.snapshot(),
        });
      } catch (err) {
        this._status = "failed";
        this.log.error("step failed", { workflowName: this.name, runId: this.runId, stepIndex: i, stepId: step.id, error: String(err) });
        await ctx.emit({
          ts: Date.now(),
          workflowName: this.name,
          runId: this.runId,
          stepIndex: i,
          event: LedgerEvent.StepFailed,
          error: String(err),
        });
        throw err;
      }
    }

    this._status = "completed";
    this.log.info("workflow complete", { workflowName: this.name, runId: this.runId });
    await this.deps.ledger.append({
      ts: Date.now(),
      workflowName: this.name,
      runId: this.runId,
      stepIndex: -1,
      event: LedgerEvent.WorkflowComplete,
    });
    return current;
  }

  async rollback(toStep = 0): Promise<void> {
    this.log.info("rolling back workflow", { workflowName: this.name, runId: this.runId });
    const stepsToUndo = [...this.completedSteps.entries()]
      .filter(([i]) => i >= toStep)
      .sort(([a], [b]) => b - a);

    for (const [i, result] of stepsToUndo) {
      const step = this.steps[i];
      if (step.rollback) {
        const ctx = this.makeContext(i);
        this.log.debug("rolling back step", { workflowName: this.name, runId: this.runId, stepIndex: i, stepId: step.id });
        await step.rollback(result.output, ctx);
        await ctx.emit({
          ts: Date.now(),
          workflowName: this.name,
          runId: this.runId,
          stepIndex: i,
          event: LedgerEvent.StepRolledBack,
        });
        this.completedSteps.delete(i);
      }
    }

    this._status = "rolled_back";
    this.log.info("workflow rolled back", { workflowName: this.name, runId: this.runId });
    await this.deps.ledger.append({
      ts: Date.now(),
      workflowName: this.name,
      runId: this.runId,
      stepIndex: -1,
      event: LedgerEvent.WorkflowFailed,
      error: "rolled_back",
    });
  }

  snapshot(): WorkflowCheckpoint {
    return {
      workflowName: this.name,
      runId: this.runId,
      stepIndex: this.completedSteps.size,
      completedSteps: Object.fromEntries(this.completedSteps),
      timestamp: Date.now(),
    };
  }

  static async resumeFromLedger(
    workflowName: string,
    runId: string,
    steps: WorkflowStep[],
    deps: WorkflowDeps,
  ): Promise<{ workflow: Workflow; nextStep: number; lastOutput: unknown }> {
    const wf = new Workflow(workflowName, runId, steps, deps);
    const entry = await deps.ledger.lastCheckpoint(workflowName, runId);

    if (entry?.payload) {
      const cp = entry.payload as WorkflowCheckpoint;
      for (const [idx, result] of Object.entries(cp.completedSteps)) {
        wf.completedSteps.set(Number(idx), result as { output: unknown; completedAt: number });
      }
      const lastOutput = cp.completedSteps[cp.stepIndex - 1]?.output ?? {};
      deps.logger?.info("resuming workflow from checkpoint", { workflowName, runId, nextStep: cp.stepIndex });
      return { workflow: wf, nextStep: cp.stepIndex, lastOutput };
    }

    return { workflow: wf, nextStep: 0, lastOutput: {} };
  }

  private makeContext(stepIndex: number): WorkflowRunContext {
    return {
      workflowName: this.name,
      runId: this.runId,
      stepIndex,
      control: this.deps.control,
      execFactory: this.deps.execFactory,
      emit: (entry) => this.deps.ledger.append(entry),
    };
  }
}
