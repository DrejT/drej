import type { ILedger, LedgerEntry } from "./ledger";
import { LedgerEvent } from "./ledger";
import type { ISandboxControl, IExecClientFactory } from "./types";
import type { ILogger } from "./logger";
import { noopLogger } from "./logger";

export interface WorkflowRunContext {
  readonly workflowId: string;
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
  workflowId: string;
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
  readonly id: string;
  private _status: WorkflowStatus = "idle";
  private readonly completedSteps = new Map<number, { output: unknown; completedAt: number }>();
  private readonly log: ILogger;

  get status(): WorkflowStatus {
    return this._status;
  }

  constructor(
    id: string,
    private readonly steps: WorkflowStep[],
    private readonly deps: WorkflowDeps,
  ) {
    this.id = id;
    this.log = deps.logger ?? noopLogger;
  }

  async run(input: unknown, startFromStep = 0): Promise<unknown> {
    this._status = "running";
    this.log.info("workflow started", { workflowId: this.id, startFromStep, totalSteps: this.steps.length });

    let current: unknown =
      startFromStep > 0 ? (this.completedSteps.get(startFromStep - 1)?.output ?? input) : input;

    for (let i = startFromStep; i < this.steps.length; i++) {
      const step = this.steps[i];
      const ctx = this.makeContext(i);

      this.log.debug("step starting", { workflowId: this.id, stepIndex: i, stepId: step.id });
      await ctx.emit({ ts: Date.now(), workflowId: this.id, stepIndex: i, event: LedgerEvent.StepStart });

      try {
        const output = await step.run(current, ctx);
        this.completedSteps.set(i, { output, completedAt: Date.now() });
        current = output;

        this.log.debug("step complete", { workflowId: this.id, stepIndex: i, stepId: step.id });
        await ctx.emit({
          ts: Date.now(),
          workflowId: this.id,
          stepIndex: i,
          event: LedgerEvent.StepComplete,
          payload: output,
        });

        // Checkpoint written after every completed step for resumption
        await this.deps.ledger.append({
          ts: Date.now(),
          workflowId: this.id,
          stepIndex: i + 1,
          event: LedgerEvent.Checkpoint,
          payload: this.snapshot(),
        });
      } catch (err) {
        this._status = "failed";
        this.log.error("step failed", { workflowId: this.id, stepIndex: i, stepId: step.id, error: String(err) });
        await ctx.emit({
          ts: Date.now(),
          workflowId: this.id,
          stepIndex: i,
          event: LedgerEvent.StepFailed,
          error: String(err),
        });
        throw err;
      }
    }

    this._status = "completed";
    this.log.info("workflow complete", { workflowId: this.id });
    await this.deps.ledger.append({
      ts: Date.now(),
      workflowId: this.id,
      stepIndex: -1,
      event: LedgerEvent.WorkflowComplete,
    });
    return current;
  }

  // Saga-style rollback: undoes completed steps in reverse order
  async rollback(toStep = 0): Promise<void> {
    this.log.info("rolling back workflow", { workflowId: this.id });
    const stepsToUndo = [...this.completedSteps.entries()]
      .filter(([i]) => i >= toStep)
      .sort(([a], [b]) => b - a);

    for (const [i, result] of stepsToUndo) {
      const step = this.steps[i];
      if (step.rollback) {
        const ctx = this.makeContext(i);
        this.log.debug("rolling back step", { workflowId: this.id, stepIndex: i, stepId: step.id });
        await step.rollback(result.output, ctx);
        await ctx.emit({
          ts: Date.now(),
          workflowId: this.id,
          stepIndex: i,
          event: LedgerEvent.StepRolledBack,
        });
        this.completedSteps.delete(i);
      }
    }

    this._status = "rolled_back";
    this.log.info("workflow rolled back", { workflowId: this.id });
    await this.deps.ledger.append({
      ts: Date.now(),
      workflowId: this.id,
      stepIndex: -1,
      event: LedgerEvent.WorkflowFailed,
      error: "rolled_back",
    });
  }

  snapshot(): WorkflowCheckpoint {
    return {
      workflowId: this.id,
      stepIndex: this.completedSteps.size,
      completedSteps: Object.fromEntries(this.completedSteps),
      timestamp: Date.now(),
    };
  }

  // Time-travel resumption: reconstructs workflow state from the last ledger checkpoint
  static async resumeFromLedger(
    workflowId: string,
    steps: WorkflowStep[],
    deps: WorkflowDeps,
  ): Promise<{ workflow: Workflow; nextStep: number; lastOutput: unknown }> {
    const wf = new Workflow(workflowId, steps, deps);
    const entry = await deps.ledger.lastCheckpoint(workflowId);

    if (entry?.payload) {
      const cp = entry.payload as WorkflowCheckpoint;
      for (const [idx, result] of Object.entries(cp.completedSteps)) {
        wf.completedSteps.set(Number(idx), result as { output: unknown; completedAt: number });
      }
      const lastOutput = cp.completedSteps[cp.stepIndex - 1]?.output ?? {};
      deps.logger?.info("resuming workflow from checkpoint", { workflowId, nextStep: cp.stepIndex });
      return { workflow: wf, nextStep: cp.stepIndex, lastOutput };
    }

    return { workflow: wf, nextStep: 0, lastOutput: {} };
  }

  private makeContext(stepIndex: number): WorkflowRunContext {
    return {
      workflowId: this.id,
      stepIndex,
      control: this.deps.control,
      execFactory: this.deps.execFactory,
      emit: (entry) => this.deps.ledger.append(entry),
    };
  }
}
