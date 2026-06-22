/** Base class for all drej workflow runtime errors. */
export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

/** Thrown when a sandbox fails to create, boot, or reach `Running` state. */
export class SandboxError extends WorkflowError {
  constructor(
    message: string,
    /** The sandbox ID, if one was assigned before the failure. */
    public readonly sandboxId?: string,
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

/**
 * Thrown when execd inside a sandbox never becomes ready within the retry window.
 * The sandbox is `Running` from the control plane's perspective, but the exec
 * daemon is not accepting connections.
 */
export class ExecConnectionError extends WorkflowError {
  constructor(public readonly sandboxId: string) {
    super(`execd not ready for sandbox ${sandboxId}`);
    this.name = "ExecConnectionError";
  }
}

/**
 * Thrown when an `exec()` step exits with a non-zero exit code and the
 * `strict` option is enabled. Carries the exit code and original command.
 */
export class CommandError extends WorkflowError {
  constructor(
    public readonly exitCode: number,
    public readonly command: string,
    public readonly sandboxId: string,
  ) {
    super(`Command exited with code ${exitCode}: ${command}`);
    this.name = "CommandError";
  }
}

/**
 * Thrown when a step exceeds its `timeoutMs` limit (either set per-step or
 * via `RunOptions.stepTimeoutMs`). The workflow will roll back after this error.
 */
export class StepTimeoutError extends WorkflowError {
  constructor(
    public readonly stepId: string,
    public readonly timeoutMs: number,
  ) {
    super(`Step "${stepId}" timed out after ${timeoutMs}ms`);
    this.name = "StepTimeoutError";
  }
}
