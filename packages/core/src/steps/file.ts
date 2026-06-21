import type { WorkflowRunContext, WorkflowStep } from "../workflow";
import type { StepDef, WorkflowState } from "./types";

export function buildWriteFileStep(def: Extract<StepDef, { type: "write_file" }>): WorkflowStep {
  return {
    id: "write_file",
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("write_file requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      const content: string | ArrayBuffer = def.encoding === "base64"
        ? Buffer.from(def.content, "base64").buffer as ArrayBuffer
        : def.content;
      await exec.uploadFile(def.path, content);
      return state;
    },
  };
}

export function buildReadFileStep(def: Extract<StepDef, { type: "read_file" }>): WorkflowStep {
  return {
    id: "read_file",
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
      const content = def.encoding === "base64" ? bytes.toString("base64") : bytes.toString("utf8");
      return { ...state, [def.as]: content };
    },
  };
}
