import type { WorkflowRunContext, WorkflowStep } from "../workflow";
import { StepType, Encoding, type StepDef, type WorkflowState } from "./types";

export function buildWriteFileStep(def: Extract<StepDef, { type: StepType.WriteFile }>): WorkflowStep {
  return {
    id: StepType.WriteFile,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("write_file requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      const content: string | ArrayBuffer = def.encoding === Encoding.Base64
        ? Buffer.from(def.content, "base64").buffer as ArrayBuffer
        : def.content;
      await exec.uploadFile(def.path, content);
      return state;
    },
  };
}

export function buildReadFileStep(def: Extract<StepDef, { type: StepType.ReadFile }>): WorkflowStep {
  return {
    id: StepType.ReadFile,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("read_file requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      const stream = await exec.downloadFile(def.path);
      const chunks: Uint8Array[] = [];
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks);
      const content = def.encoding === Encoding.Base64 ? bytes.toString("base64") : bytes.toString("utf8");
      return { ...state, [def.as]: content };
    },
  };
}
