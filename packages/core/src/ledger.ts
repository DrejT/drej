
export enum LedgerEvent {
  RunStarted = "run_started",
  StepStart = "step_start",
  StepComplete = "step_complete",
  StepFailed = "step_failed",
  StepRolledBack = "step_rolled_back",
  WorkflowComplete = "workflow_complete",
  WorkflowFailed = "workflow_failed",
  Checkpoint = "checkpoint",
  ExecEvent = "exec_event",
  Snapshot = "snapshot",
}

export interface LedgerEntry {
  ts: number;
  workflowName: string;
  runId: string;
  stepIndex: number;
  branch?: number;
  event: LedgerEvent;
  payload?: unknown;
  error?: string;
}

export interface IStorageAdapter {
  connect?(): Promise<void>;
  close?(): Promise<void>;
  append(entry: LedgerEntry): Promise<void>;
  readAll(workflowName: string, runId: string): Promise<LedgerEntry[]>;
  lastCheckpoint(workflowName: string, runId: string): Promise<LedgerEntry | null>;
  listRuns(workflowName: string): Promise<string[]>;
}
