import { StepType, validateWorkflow, type StepDef } from "@drej/core";
import type { Sandbox } from "@drej/opensandbox";
import { wrapSteps, type SandboxOpts } from "./types";
import { SandboxStepBuilder } from "./sandbox-step";

class WorkflowParallelBuilder {
  private _branches: StepDef[] = [];

  sandbox(optsOrSandbox: SandboxOpts | Sandbox, fn: (s: SandboxStepBuilder) => void): this {
    const sb = new SandboxStepBuilder();
    fn(sb);
    const innerSteps = sb.build();
    this._branches.push({
      type: StepType.Sequence,
      steps: "id" in optsOrSandbox
        ? innerSteps
        : [{ type: StepType.CreateSandbox, entrypoint: ["tail", "-f", "/dev/null"], ...optsOrSandbox }, ...innerSteps],
    });
    return this;
  }

  branch(fn: (s: SandboxStepBuilder) => void): this {
    const sb = new SandboxStepBuilder();
    fn(sb);
    this._branches.push(wrapSteps(sb.build()));
    return this;
  }

  build(): StepDef[] {
    return this._branches;
  }
}

/**
 * Top-level workflow builder. Create one with `workflow(name)` then chain
 * `.sandbox()` or `.parallel()` calls to define steps.
 *
 * @example
 * ```ts
 * const wf = workflow("deploy")
 *   .sandbox({ image: { uri: "node:20-slim" } }, (s) =>
 *     s.exec("npm ci").exec("npm run build"),
 *   );
 * const run = await client.run(wf);
 * ```
 */
export class WorkflowBuilder {
  private _steps: StepDef[] = [];
  private _initialState: Record<string, unknown> = {};

  constructor(private _name: string) {}

  /**
   * Run steps inside a sandbox. Accepts either sandbox options to create a new
   * sandbox, or an existing `Sandbox` object returned by `client.createSandbox()`.
   *
   * @example
   * ```ts
   * workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
   *   s.exec("npm ci").exec("npm test"),
   * )
   * ```
   */
  sandbox(optsOrSandbox: SandboxOpts | Sandbox, fn: (s: SandboxStepBuilder) => void): this {
    const sb = new SandboxStepBuilder();
    fn(sb);
    if ("id" in optsOrSandbox) {
      this._initialState.sandboxId = optsOrSandbox.id;
      this._steps.push(...sb.build());
    } else {
      this._steps.push(
        { type: StepType.CreateSandbox, entrypoint: ["tail", "-f", "/dev/null"], ...optsOrSandbox },
        ...sb.build(),
      );
    }
    return this;
  }

  parallel(fn: (p: WorkflowParallelBuilder) => WorkflowParallelBuilder, opts?: { concurrency?: number }): this {
    const pb = new WorkflowParallelBuilder();
    fn(pb);
    this._steps.push({ type: StepType.Parallel, steps: pb.build(), ...(opts?.concurrency ? { maxConcurrency: opts.concurrency } : {}) });
    return this;
  }

  build(): { name: string; steps: StepDef[]; initialState: Record<string, unknown> } {
    validateWorkflow(this._name, this._steps);
    return { name: this._name, steps: this._steps, initialState: this._initialState };
  }
}

/**
 * Create a new workflow with the given name.
 *
 * @example
 * ```ts
 * const run = await client.run(
 *   workflow("hello-world").sandbox(
 *     { image: { uri: "node:20-slim" } },
 *     (s) => s.exec("echo hello"),
 *   ),
 * );
 * ```
 */
export function workflow(name: string): WorkflowBuilder {
  return new WorkflowBuilder(name);
}
