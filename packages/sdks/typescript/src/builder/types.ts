import { StepType, type StepDef } from "@drej/core";
import type { ImageSpec, Resources } from "@drej/opensandbox";

/**
 * A typed reference to a workflow state key. Returned by output-producing step
 * methods (readFile, searchFiles, etc.). Works in template literals — use
 * `\`echo ${myRef}\`` to interpolate the captured value in later steps.
 */
export class Ref<T> {
  constructor(readonly key: string) {}
  toString(): string { return `{{${this.key}}}`; }
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

/**
 * Represents the current loop variable inside a `forEach` callback.
 * Serialises to `{{name}}` in template literals. Property access descends into
 * the object at runtime: `entry.path` → `{{item.path}}`.
 */
export type LoopItem = { toString(): string } & { readonly [key: string]: LoopItem };

function makeLoopVar(name: string): LoopItem {
  return new Proxy({} as LoopItem, {
    get(_target, prop) {
      if (prop === "toString" || prop === Symbol.toPrimitive) return () => `{{${name}}}`;
      if (typeof prop === "string") return makeLoopVar(`${name}.${prop}`);
      return undefined;
    },
  });
}

export function createLoopVar(name: string): LoopItem {
  return makeLoopVar(name);
}

export function wrapSteps(steps: StepDef[]): StepDef {
  return steps.length === 1 ? steps[0] : { type: StepType.Sequence, steps };
}
