import type { ILedger, LedgerEntry } from "./ledger";
import type { ISandboxControl, IExecClientFactory } from "./types";

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
}

export class Workflow {
  readonly id: string;
  private _status: WorkflowStatus = "idle";
  private readonly completedSteps = new Map<number, { output: unknown; completedAt: number }>();

  get status(): WorkflowStatus {
    return this._status;
  }

  constructor(
    id: string,
    private readonly steps: WorkflowStep[],
    private readonly deps: WorkflowDeps,
  ) {
    this.id = id;
  }

  async run(input: unknown, startFromStep = 0): Promise<unknown> {
    this._status = "running";
    let current: unknown =
      startFromStep > 0 ? (this.completedSteps.get(startFromStep - 1)?.output ?? input) : input;

    for (let i = startFromStep; i < this.steps.length; i++) {
      const step = this.steps[i];
      const ctx = this.makeContext(i);

      await ctx.emit({ ts: Date.now(), workflowId: this.id, stepIndex: i, event: "step_start" });

      try {
        const output = await step.run(current, ctx);
        this.completedSteps.set(i, { output, completedAt: Date.now() });
        current = output;

        await ctx.emit({
          ts: Date.now(),
          workflowId: this.id,
          stepIndex: i,
          event: "step_complete",
          payload: output,
        });

        // Checkpoint written to ledger after every completed step for time-travel resumption
        await this.deps.ledger.append({
          ts: Date.now(),
          workflowId: this.id,
          stepIndex: i + 1,
          event: "checkpoint",
          payload: this.snapshot(),
        });
      } catch (err) {
        this._status = "failed";
        await ctx.emit({
          ts: Date.now(),
          workflowId: this.id,
          stepIndex: i,
          event: "step_failed",
          error: String(err),
        });
        throw err;
      }
    }

    this._status = "completed";
    await this.deps.ledger.append({
      ts: Date.now(),
      workflowId: this.id,
      stepIndex: -1,
      event: "workflow_complete",
    });
    return current;
  }

  // Saga-style rollback: undoes completed steps in reverse order
  async rollback(toStep = 0): Promise<void> {
    const stepsToUndo = [...this.completedSteps.entries()]
      .filter(([i]) => i >= toStep)
      .sort(([a], [b]) => b - a);

    for (const [i, result] of stepsToUndo) {
      const step = this.steps[i];
      if (step.rollback) {
        const ctx = this.makeContext(i);
        await step.rollback(result.output, ctx);
        await ctx.emit({
          ts: Date.now(),
          workflowId: this.id,
          stepIndex: i,
          event: "step_rolled_back",
        });
        this.completedSteps.delete(i);
      }
    }

    this._status = "rolled_back";
    await this.deps.ledger.append({
      ts: Date.now(),
      workflowId: this.id,
      stepIndex: -1,
      event: "workflow_failed",
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
