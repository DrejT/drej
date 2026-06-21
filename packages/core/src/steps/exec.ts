import { SSEEventType } from "@drej/opensandbox";
import type { SSEEvent } from "@drej/opensandbox";
import { LedgerEvent } from "../ledger";
import { CommandError } from "../errors";
import type { WorkflowRunContext, WorkflowStep } from "../workflow";
import { StepType, type StepDef, type WorkflowState } from "./types";
import { interpolate } from "./utils";

export function buildExecCommandStep(def: Extract<StepDef, { type: StepType.ExecCommand }>): WorkflowStep {
  return {
    id: StepType.ExecCommand,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("exec_command requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      const raw = interpolate(def.command, state);
      // base64-encode so newlines, quotes, special chars survive the JSON boundary
      const command = `echo ${Buffer.from(raw).toString("base64")} | base64 -d | bash`;
      const cwd = def.cwd ? interpolate(def.cwd, state) : undefined;
      const envs = def.envs
        ? Object.fromEntries(Object.entries(def.envs).map(([k, v]) => [k, interpolate(v, state)]))
        : undefined;
      const events: SSEEvent[] = [];
      let exitCode = 0;
      const stdoutChunks: string[] = [];
      for await (const ev of exec.executeCommand({ command, cwd, envs })) {
        await ctx.emit({
          ts: Date.now(),
          workflowName: ctx.workflowName,
          runId: ctx.runId,
          stepIndex: ctx.stepIndex,
          event: LedgerEvent.ExecEvent,
          payload: ev,
        });
        events.push(ev as unknown as SSEEvent);
        if (ev.type === SSEEventType.Error && ev.error?.evalue !== undefined) {
          const code = Number(ev.error.evalue);
          if (!isNaN(code)) exitCode = code;
        }
        if (def.capture && ev.type === SSEEventType.Stdout && ev.text) {
          stdoutChunks.push(ev.text);
        }
      }
      const next: WorkflowState = { ...state, commandEvents: events, exitCode };
      if (def.capture) next[def.capture] = stdoutChunks.join("").trimEnd();
      if (def.strict && exitCode !== 0) {
        throw new CommandError(exitCode, def.command, state.sandboxId!);
      }
      return next;
    },
  };
}

export function buildExecCodeStep(def: Extract<StepDef, { type: StepType.ExecCode }>): WorkflowStep {
  return {
    id: StepType.ExecCode,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("exec_code requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      const events: SSEEvent[] = [];
      for await (const ev of exec.executeCode({ code: def.code, context: def.context })) {
        await ctx.emit({
          ts: Date.now(),
          workflowName: ctx.workflowName,
          runId: ctx.runId,
          stepIndex: ctx.stepIndex,
          event: LedgerEvent.ExecEvent,
          payload: ev,
        });
        events.push(ev as unknown as SSEEvent);
      }
      return { ...state, codeEvents: events };
    },
  };
}
