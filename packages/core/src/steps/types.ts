import { CodeLanguage } from "@drej/opensandbox";

export type Predicate =
  | { op: "eq" | "neq"; field: string; value: unknown }
  | { op: "gt" | "lt" | "gte" | "lte"; field: string; value: number }
  | { op: "exists" | "not_exists"; field: string }
  | { op: "and" | "or"; predicates: Predicate[] };

export enum StepType {
  CreateSandbox = "create_sandbox",
  ExecCode      = "exec_code",
  ExecCommand   = "exec_command",
  DeleteSandbox = "delete_sandbox",
  WriteFile     = "write_file",
  ReadFile      = "read_file",
  DeleteFile      = "delete_file",
  MoveFile        = "move_file",
  ListDirectory   = "list_directory",
  SearchFiles     = "search_files",
  CreateDirectory = "create_directory",
  DeleteDirectory = "delete_directory",
  SetPermissions  = "set_permissions",
  ReplaceInFiles  = "replace_in_files",
  GetFileInfo     = "get_file_info",
  Snapshot        = "snapshot",
  Retry         = "retry",
  Conditional   = "conditional",
  Loop          = "loop",
  Parallel      = "parallel",
  Sequence      = "sequence",
}

export enum Encoding {
  UTF8   = "utf8",
  Base64 = "base64",
}

export enum Backoff {
  Fixed       = "fixed",
  Exponential = "exponential",
}

export type StepDef =
  | {
      type: StepType.CreateSandbox;
      image?: { uri: string; auth?: { username: string; password: string } };
      snapshotId?: string;
      timeout?: number;
      entrypoint?: string[];
      env?: Record<string, string>;
      metadata?: Record<string, string>;
      resourceLimits?: { cpu?: string; memory?: string; gpu?: string };
    }
  | { type: StepType.ExecCode; code: string; context?: { id: string; language: CodeLanguage } }
  | { type: StepType.ExecCommand; command: string; cwd?: string; envs?: Record<string, string>; capture?: string; strict?: boolean }
  | { type: StepType.DeleteSandbox }
  | { type: StepType.WriteFile; path: string; content: string; encoding?: Encoding }
  | { type: StepType.ReadFile; path: string; as: string; encoding?: Encoding }
  | { type: StepType.DeleteFile; path: string }
  | { type: StepType.MoveFile; from: string; to: string }
  | { type: StepType.ListDirectory; path: string; as: string; depth?: number }
  | { type: StepType.SearchFiles; pattern: string; as: string; dir?: string }
  | { type: StepType.CreateDirectory; path: string }
  | { type: StepType.DeleteDirectory; path: string }
  | { type: StepType.SetPermissions; path: string; mode: string }
  | { type: StepType.ReplaceInFiles; replacements: Array<{ path: string; old: string; new: string }> }
  | { type: StepType.GetFileInfo; path: string; as: string }
  | { type: StepType.Snapshot }
  | { type: StepType.Retry; step: StepDef; maxAttempts: number; delayMs?: number; backoff?: Backoff }
  | { type: StepType.Conditional; condition: Predicate; then: StepDef[]; else?: StepDef[] }
  | { type: StepType.Loop; over?: string; items?: unknown[]; as: string; steps: StepDef[]; maxConcurrency?: number }
  | { type: StepType.Parallel; steps: StepDef[]; maxConcurrency?: number }
  | { type: StepType.Sequence; steps: StepDef[] };

export type WorkflowState = Record<string, unknown> & { sandboxId?: string };

export interface SnapshotConfig {
  afterSteps?: number[];
  everyNSteps?: number;
}
