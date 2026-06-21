import type { WorkflowStep } from "../workflow";
import { StepType, type StepDef } from "./types";
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
    case StepType.CreateSandbox: return buildCreateSandboxStep(def);
    case StepType.DeleteSandbox: return buildDeleteSandboxStep();
    case StepType.ExecCommand:   return buildExecCommandStep(def);
    case StepType.ExecCode:      return buildExecCodeStep(def);
    case StepType.WriteFile:     return buildWriteFileStep(def);
    case StepType.ReadFile:      return buildReadFileStep(def);
    case StepType.Snapshot:      return buildSnapshotStep();
    case StepType.Retry:         return buildRetryStep(def, buildStep);
    case StepType.Conditional:   return buildConditionalStep(def, buildStep);
    case StepType.Loop:          return buildLoopStep(def, buildStep);
    case StepType.Parallel:      return buildParallelStep(def, buildStep);
    case StepType.Sequence:      return buildSequenceStep(def, buildStep);
  }
}

export { StepType, Encoding, Backoff } from "./types";
export type { StepDef, Predicate, WorkflowState, SnapshotConfig } from "./types";
export { resolveExecClient } from "./sandbox";
export { shouldSnapshot, waitForSnapshot } from "./snapshot";
