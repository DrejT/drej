import type { StepDef } from "@drej/core";
import type { ImageSpec, Resources } from "@drej/opensandbox";

/** Options for creating a sandbox within a workflow step. */
export type SandboxOpts = {
  /** Container image to boot. Omit when booting from a `snapshotId`. */
  image?: ImageSpec;
  /** Boot from this snapshot ID instead of pulling a fresh image. */
  snapshotId?: string;
  /** Maximum seconds before the sandbox is forcibly terminated. */
  timeout?: number;
  /** Override the container entrypoint. Defaults to `["tail", "-f", "/dev/null"]`. */
  entrypoint?: string[];
  /** Environment variables injected into every exec call in this sandbox. */
  env?: Record<string, string>;
  /** Arbitrary key/value metadata attached to the sandbox for filtering. */
  metadata?: Record<string, string>;
  /** CPU and memory limits. */
  resourceLimits?: Resources;
};

/** Represents the current loop variable inside a `forEach` callback. Serialises to `{{name}}`. */
export type LoopItem = { toString(): string };

class LoopVar implements LoopItem {
  constructor(private name: string) {}
  toString() { return `{{${this.name}}}`; }
}

export function createLoopVar(name: string): LoopItem {
  return new LoopVar(name);
}

export function wrapSteps(steps: StepDef[]): StepDef {
  return steps.length === 1 ? steps[0] : { type: "sequence", steps };
}
