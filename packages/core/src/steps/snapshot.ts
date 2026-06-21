import { SnapshotState } from "@drej/opensandbox";
import type { ControlClient } from "@drej/opensandbox";
import { LedgerEvent } from "../ledger";
import type { WorkflowRunContext, WorkflowStep } from "../workflow";
import { StepType, type WorkflowState, type SnapshotConfig } from "./types";

export function shouldSnapshot(config: SnapshotConfig, stepIndex: number): boolean {
  if (config.afterSteps?.includes(stepIndex)) return true;
  if (config.everyNSteps && (stepIndex + 1) % config.everyNSteps === 0) return true;
  return false;
}

export async function waitForSnapshot(
  control: ControlClient,
  snapshotId: string,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await control.getSnapshot(snapshotId);
    if (snap.state === SnapshotState.Ready) return;
    if (snap.state === SnapshotState.Failed) throw new Error(`Snapshot ${snapshotId} failed`);
    await new Promise<void>((r) => setTimeout(r, 2_000));
  }
  throw new Error(`Snapshot ${snapshotId} did not become ready within ${timeoutMs}ms`);
}

export function buildSnapshotStep(): WorkflowStep {
  return {
    id: StepType.Snapshot,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("snapshot requires sandboxId in workflow state");
      const snap = await ctx.control.createSnapshot(state.sandboxId);
      await waitForSnapshot(ctx.control, snap.id);
      await ctx.emit({
        ts: Date.now(),
        workflowName: ctx.workflowName,
        runId: ctx.runId,
        stepIndex: ctx.stepIndex,
        event: LedgerEvent.Snapshot,
        payload: { snapshotId: snap.id, sandboxId: state.sandboxId },
      });
      return { ...state, snapshotId: snap.id };
    },
  };
}
