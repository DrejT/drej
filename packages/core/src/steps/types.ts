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
  Snapshot      = "snapshot",
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
