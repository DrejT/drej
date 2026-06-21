import type { IStorageAdapter, LedgerEntry } from "./ledger";
import { LedgerEvent } from "./ledger";
import type { ControlClient, ExecClient } from "@drejt/opensandbox";
import type { ILogger } from "./logger";
import { noopLogger } from "./logger";

export interface WorkflowRunContext {
  readonly workflowName: string;
  readonly runId: string;
  readonly stepIndex: number;
  readonly control: ControlClient;
  readonly resolveExec: (sandboxId: string) => Promise<ExecClient>;
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

export enum WorkflowStatus {
  Idle = "idle",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  RolledBack = "rolled_back",
}

export interface WorkflowHooks {
  onStepStart?(info: { workflowName: string; runId: string; stepIndex: number; stepId: string }): void | Promise<void>;
  onStepComplete?(info: { workflowName: string; runId: string; stepIndex: number; stepId: string; output: unknown }): void | Promise<void>;
  onStepFailed?(info: { workflowName: string; runId: string; stepIndex: number; stepId: string; error: Error }): void | Promise<void>;
  onStepRolledBack?(info: { workflowName: string; runId: string; stepIndex: number; stepId: string }): void | Promise<void>;
  onWorkflowComplete?(info: { workflowName: string; runId: string; output: unknown }): void | Promise<void>;
  onWorkflowFailed?(info: { workflowName: string; runId: string; error: Error }): void | Promise<void>;
}

export interface WorkflowDeps {
  control: ControlClient;
  resolveExec: (sandboxId: string) => Promise<ExecClient>;
  adapter: IStorageAdapter;
  logger?: ILogger;
  hooks?: WorkflowHooks;
}

export class Workflow {
  readonly name: string;
  readonly runId: string;
  private _status: WorkflowStatus = WorkflowStatus.Idle;
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

  private async callHook<K extends keyof WorkflowHooks>(
    name: K,
    info: Parameters<NonNullable<WorkflowHooks[K]>>[0],
  ): Promise<void> {
    const hook = this.deps.hooks?.[name] as ((i: typeof info) => void | Promise<void>) | undefined;
    if (!hook) return;
    try {
      await hook(info);
    } catch (err) {
      this.log.warn(`hook ${name} threw`, { error: String(err) });
    }
  }

  async run(input: unknown, startFromStep = 0): Promise<unknown> {
    this._status = WorkflowStatus.Running;
    this.log.info("workflow started", { workflowName: this.name, runId: this.runId, startFromStep, totalSteps: this.steps.length });

    let current: unknown =
      startFromStep > 0 ? (this.completedSteps.get(startFromStep - 1)?.output ?? input) : input;

    for (let i = startFromStep; i < this.steps.length; i++) {
      const step = this.steps[i];
      const ctx = this.makeContext(i);

      this.log.debug("step starting", { workflowName: this.name, runId: this.runId, stepIndex: i, stepId: step.id });
      await this.callHook("onStepStart", { workflowName: this.name, runId: this.runId, stepIndex: i, stepId: step.id });
      await ctx.emit({ ts: Date.now(), workflowName: this.name, runId: this.runId, stepIndex: i, event: LedgerEvent.StepStart });

      try {
        const output = await step.run(current, ctx);
        this.completedSteps.set(i, { output, completedAt: Date.now() });
        current = output;

        this.log.debug("step complete", { workflowName: this.name, runId: this.runId, stepIndex: i, stepId: step.id });
        await this.callHook("onStepComplete", { workflowName: this.name, runId: this.runId, stepIndex: i, stepId: step.id, output });
        await ctx.emit({
          ts: Date.now(),
          workflowName: this.name,
          runId: this.runId,
          stepIndex: i,
          event: LedgerEvent.StepComplete,
          payload: output,
        });

        await this.deps.adapter.append({
          ts: Date.now(),
          workflowName: this.name,
          runId: this.runId,
          stepIndex: i + 1,
          event: LedgerEvent.Checkpoint,
          payload: this.snapshot(),
        });
      } catch (err) {
        this._status = WorkflowStatus.Failed;
        const error = err instanceof Error ? err : new Error(String(err));
        this.log.error("step failed", { workflowName: this.name, runId: this.runId, stepIndex: i, stepId: step.id, error: error.message });
        await this.callHook("onStepFailed", { workflowName: this.name, runId: this.runId, stepIndex: i, stepId: step.id, error });
        await ctx.emit({
          ts: Date.now(),
          workflowName: this.name,
          runId: this.runId,
          stepIndex: i,
          event: LedgerEvent.StepFailed,
          error: error.message,
        });
        await this.callHook("onWorkflowFailed", { workflowName: this.name, runId: this.runId, error });
        throw error;
      }
    }

    this._status = WorkflowStatus.Completed;
    this.log.info("workflow complete", { workflowName: this.name, runId: this.runId });
    await this.deps.adapter.append({
      ts: Date.now(),
      workflowName: this.name,
      runId: this.runId,
      stepIndex: -1,
      event: LedgerEvent.WorkflowComplete,
    });
    await this.callHook("onWorkflowComplete", { workflowName: this.name, runId: this.runId, output: current });
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
        await this.callHook("onStepRolledBack", { workflowName: this.name, runId: this.runId, stepIndex: i, stepId: step.id });
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

    this._status = WorkflowStatus.RolledBack;
    this.log.info("workflow rolled back", { workflowName: this.name, runId: this.runId });
    await this.deps.adapter.append({
      ts: Date.now(),
      workflowName: this.name,
      runId: this.runId,
      stepIndex: -1,
      event: LedgerEvent.WorkflowFailed,
      error: "rolled_back",
    });
    await this.callHook("onWorkflowFailed", { workflowName: this.name, runId: this.runId, error: new Error("rolled_back") });
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
    const entry = await deps.adapter.lastCheckpoint(workflowName, runId);

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
      resolveExec: this.deps.resolveExec,
      emit: (entry) => this.deps.adapter.append(entry),
    };
  }
}
