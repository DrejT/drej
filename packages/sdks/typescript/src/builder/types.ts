import { StepType, type StepDef } from "@drej/core";
import type { ImageSpec, Resources } from "@drej/opensandbox";

/**
 * A typed reference to a workflow state key. Use `ref("name")` to create one.
 * Resolves to the value stored under `name` in workflow state at runtime.
 * Works naturally in template literals: `\`echo ${sha}\`` → `"echo {{sha}}"`.
 */
export class Ref<T> {
  constructor(readonly key: string) {}
  toString(): string { return `{{${this.key}}}`; }
}

/** Create a typed reference to a workflow state key. */
export function ref<T>(name: string): Ref<T> {
  return new Ref<T>(name);
}

/** @internal */
export function refKey(val: Ref<unknown> | string): string {
  return val instanceof Ref ? val.key : val;
}

/** @internal */
export function refStr(val: Ref<unknown> | string): string {
  return val instanceof Ref ? val.toString() : val;
}

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
  return steps.length === 1 ? steps[0] : { type: StepType.Sequence, steps };
}
