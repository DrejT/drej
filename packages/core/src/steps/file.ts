import type { WorkflowRunContext, WorkflowStep } from "../workflow";
import { StepType, Encoding, type StepDef, type WorkflowState } from "./types";
import { interpolate } from "./utils";

export function buildWriteFileStep(def: Extract<StepDef, { type: StepType.WriteFile }>): WorkflowStep {
  return {
    id: StepType.WriteFile,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("write_file requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      const path = interpolate(def.path, state);
      const content: string | ArrayBuffer = def.encoding === Encoding.Base64
        ? Buffer.from(def.content, "base64").buffer as ArrayBuffer
        : interpolate(def.content, state);
      await exec.uploadFile(path, content);
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
      const stream = await exec.downloadFile(interpolate(def.path, state));
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

export function buildDeleteFileStep(def: Extract<StepDef, { type: StepType.DeleteFile }>): WorkflowStep {
  return {
    id: StepType.DeleteFile,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("delete_file requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      await exec.deleteFile(interpolate(def.path, state));
      return state;
    },
  };
}

export function buildMoveFileStep(def: Extract<StepDef, { type: StepType.MoveFile }>): WorkflowStep {
  return {
    id: StepType.MoveFile,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("move_file requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      await exec.moveFile(interpolate(def.from, state), interpolate(def.to, state));
      return state;
    },
  };
}

export function buildListDirectoryStep(def: Extract<StepDef, { type: StepType.ListDirectory }>): WorkflowStep {
  return {
    id: StepType.ListDirectory,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("list_directory requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      const entries = await exec.listDirectory(interpolate(def.path, state), def.depth);
      return { ...state, [def.as]: entries };
    },
  };
}

export function buildSearchFilesStep(def: Extract<StepDef, { type: StepType.SearchFiles }>): WorkflowStep {
  return {
    id: StepType.SearchFiles,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("search_files requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      const dir = def.dir ? interpolate(def.dir, state) : undefined;
      const matches = await exec.searchFiles(interpolate(def.pattern, state), dir);
      return { ...state, [def.as]: matches };
    },
  };
}

export function buildCreateDirectoryStep(def: Extract<StepDef, { type: StepType.CreateDirectory }>): WorkflowStep {
  return {
    id: StepType.CreateDirectory,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("create_directory requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      await exec.createDirectory(interpolate(def.path, state));
      return state;
    },
  };
}

export function buildDeleteDirectoryStep(def: Extract<StepDef, { type: StepType.DeleteDirectory }>): WorkflowStep {
  return {
    id: StepType.DeleteDirectory,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("delete_directory requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      await exec.deleteDirectory(interpolate(def.path, state));
      return state;
    },
  };
}

export function buildSetPermissionsStep(def: Extract<StepDef, { type: StepType.SetPermissions }>): WorkflowStep {
  return {
    id: StepType.SetPermissions,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("set_permissions requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      await exec.setPermissions(interpolate(def.path, state), interpolate(def.mode, state));
      return state;
    },
  };
}

export function buildReplaceInFilesStep(def: Extract<StepDef, { type: StepType.ReplaceInFiles }>): WorkflowStep {
  return {
    id: StepType.ReplaceInFiles,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("replace_in_files requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      const replacements = def.replacements.map((r) => ({
        path: interpolate(r.path, state),
        old:  interpolate(r.old, state),
        new:  interpolate(r.new, state),
      }));
      await exec.replaceInFiles(replacements);
      return state;
    },
  };
}

export function buildGetFileInfoStep(def: Extract<StepDef, { type: StepType.GetFileInfo }>): WorkflowStep {
  return {
    id: StepType.GetFileInfo,
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (!state.sandboxId) throw new Error("get_file_info requires sandboxId in workflow state");
      const exec = await ctx.resolveExec(state.sandboxId);
      const info = await exec.getFileInfo(interpolate(def.path, state));
      return { ...state, [def.as]: info };
    },
  };
}
