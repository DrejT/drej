import type { WorkflowStep } from "../workflow";
import type { StepDef } from "./types";
import { buildCreateSandboxStep, buildDeleteSandboxStep } from "./sandbox";
import { buildExecCommandStep, buildExecCodeStep } from "./exec";
import { buildWriteFileStep, buildReadFileStep } from "./file";
import { buildSnapshotStep } from "./snapshot";
import {
  buildRetryStep,
  buildConditionalStep,
  buildLoopStep,
  buildParallelStep,
  buildSequenceStep,
} from "./control-flow";

export function buildStep(def: StepDef): WorkflowStep {
  switch (def.type) {
    case "create_sandbox": return buildCreateSandboxStep(def);
    case "delete_sandbox": return buildDeleteSandboxStep();
    case "exec_command":   return buildExecCommandStep(def);
    case "exec_code":      return buildExecCodeStep(def);
    case "write_file":     return buildWriteFileStep(def);
    case "read_file":      return buildReadFileStep(def);
    case "snapshot":       return buildSnapshotStep();
    case "retry":          return buildRetryStep(def, buildStep);
    case "conditional":    return buildConditionalStep(def, buildStep);
    case "loop":           return buildLoopStep(def, buildStep);
    case "parallel":       return buildParallelStep(def, buildStep);
    case "sequence":       return buildSequenceStep(def, buildStep);
  }
}

export type { StepDef, Predicate, WorkflowState, SnapshotConfig } from "./types";
export { resolveExecClient } from "./sandbox";
export { shouldSnapshot, waitForSnapshot } from "./snapshot";
