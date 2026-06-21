import { CodeLanguage } from "@drej/opensandbox";

export type Predicate =
  | { op: "eq" | "neq"; field: string; value: unknown }
  | { op: "gt" | "lt" | "gte" | "lte"; field: string; value: number }
  | { op: "exists" | "not_exists"; field: string }
  | { op: "and" | "or"; predicates: Predicate[] };

export type StepDef =
  | {
      type: "create_sandbox";
      image?: { uri: string; auth?: { username: string; password: string } };
      snapshotId?: string;
      timeout?: number;
      entrypoint?: string[];
      env?: Record<string, string>;
      metadata?: Record<string, string>;
      resourceLimits?: { cpu?: string; memory?: string; gpu?: string };
    }
  | { type: "exec_code"; code: string; context?: { id: string; language: CodeLanguage } }
  | { type: "exec_command"; command: string; cwd?: string; envs?: Record<string, string>; capture?: string; strict?: boolean }
  | { type: "delete_sandbox" }
  | { type: "write_file"; path: string; content: string; encoding?: "utf8" | "base64" }
  | { type: "read_file"; path: string; as: string; encoding?: "utf8" | "base64" }
  | { type: "snapshot" }
  | { type: "retry"; step: StepDef; maxAttempts: number; delayMs?: number; backoff?: "fixed" | "exponential" }
  | { type: "conditional"; condition: Predicate; then: StepDef[]; else?: StepDef[] }
  | { type: "loop"; over?: string; items?: unknown[]; as: string; steps: StepDef[]; maxConcurrency?: number }
  | { type: "parallel"; steps: StepDef[]; maxConcurrency?: number }
  | { type: "sequence"; steps: StepDef[] };

export type WorkflowState = Record<string, unknown> & { sandboxId?: string };

export interface SnapshotConfig {
  afterSteps?: number[];
  everyNSteps?: number;
}
