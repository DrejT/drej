import type { StepDef, ImageSpec, Resources, Predicate } from "./client";

// Placeholder that serialises to {{name}} inside template literals.
// Used as the `item` parameter in forEach callbacks so users write
// `s.exec(`upload ${item}`)` instead of `s.exec("upload {{item}}")`.
class LoopVar {
  constructor(private name: string) {}
  toString() {
    return `{{${this.name}}}`;
  }
}

export type LoopItem = { toString(): string };

export type SandboxOpts = {
  image?: ImageSpec;
  snapshotId?: string;
  timeout?: number;
  entrypoint?: string[];
  env?: Record<string, string>;
  metadata?: Record<string, string>;
  resourceLimits?: Resources;
};

type ForEachOpts = {
  concurrency?: number;
  as?: string;
};

type ForEachSource = unknown[] | { from: string };
type ForEachCallback = (s: SandboxStepBuilder, item: LoopItem) => SandboxStepBuilder | string;

function wrapSteps(steps: StepDef[]): StepDef {
  return steps.length === 1 ? steps[0] : { type: "sequence", steps };
}

// ── SandboxStepBuilder ────────────────────────────────────────────────────────

export class SandboxStepBuilder {
  protected _steps: StepDef[] = [];

  exec(command: string, opts?: { cwd?: string; envs?: Record<string, string> }): this {
    this._steps.push({ type: "exec_command", command, ...opts });
    return this;
  }

  writeFile(path: string, content: string, encoding?: "utf8" | "base64"): this {
    this._steps.push({ type: "write_file", path, content, ...(encoding ? { encoding } : {}) });
    return this;
  }

  retry(
    maxAttempts: number,
    fn: (s: SandboxStepBuilder) => SandboxStepBuilder,
    opts?: { delayMs?: number; backoff?: "fixed" | "exponential" },
  ): this {
    const inner = new SandboxStepBuilder();
    fn(inner);
    this._steps.push({ type: "retry", step: wrapSteps(inner.build()), maxAttempts, ...opts });
    return this;
  }

  forEach(source: ForEachSource, fn: ForEachCallback): this;
  forEach(source: ForEachSource, opts: ForEachOpts, fn: ForEachCallback): this;
  forEach(
    source: ForEachSource,
    optsOrFn: ForEachOpts | ForEachCallback,
    fn?: ForEachCallback,
  ): this {
    const opts: ForEachOpts = typeof optsOrFn === "function" ? {} : optsOrFn;
    const callback: ForEachCallback = typeof optsOrFn === "function" ? optsOrFn : fn!;

    const varName = opts.as ?? "item";
    const loopVar = new LoopVar(varName);
    const inner = new SandboxStepBuilder();
    const result = callback(inner, loopVar);

    const steps: StepDef[] =
      typeof result === "string"
        ? [{ type: "exec_command", command: result }]
        : result.build();

    this._steps.push({
      type: "loop",
      as: varName,
      steps,
      ...(Array.isArray(source) ? { items: source } : { over: source.from }),
      ...(opts.concurrency !== undefined && opts.concurrency > 1 ? { concurrently: true } : {}),
    });

    return this;
  }

  when(
    condition: Predicate,
    thenFn: (s: SandboxStepBuilder) => SandboxStepBuilder,
    elseFn?: (s: SandboxStepBuilder) => SandboxStepBuilder,
  ): this {
    const thenBuilder = new SandboxStepBuilder();
    thenFn(thenBuilder);

    const elseSteps = elseFn
      ? (() => {
          const b = new SandboxStepBuilder();
          elseFn(b);
          return b.build();
        })()
      : undefined;

    this._steps.push({
      type: "conditional",
      condition,
      then: thenBuilder.build(),
      ...(elseSteps ? { else: elseSteps } : {}),
    });

    return this;
  }

  parallel(fn: (p: SandboxParallelBuilder) => SandboxParallelBuilder): this {
    const pb = new SandboxParallelBuilder();
    fn(pb);
    this._steps.push({ type: "parallel", steps: pb.build() });
    return this;
  }

  build(): StepDef[] {
    return [...this._steps];
  }
}

// ── SandboxParallelBuilder ────────────────────────────────────────────────────
// Used inside a sandbox scope — branches share the same sandbox, no new ones.

class SandboxParallelBuilder {
  private _branches: StepDef[] = [];

  branch(fn: (s: SandboxStepBuilder) => SandboxStepBuilder): this {
    const sb = new SandboxStepBuilder();
    fn(sb);
    this._branches.push(wrapSteps(sb.build()));
    return this;
  }

  build(): StepDef[] {
    return this._branches;
  }
}

// ── WorkflowParallelBuilder ───────────────────────────────────────────────────
// Used at the top-level workflow scope — each branch can own its own sandbox.

class WorkflowParallelBuilder {
  private _branches: StepDef[] = [];

  sandbox(opts: SandboxOpts, fn: (s: SandboxStepBuilder) => SandboxStepBuilder): this {
    const sb = new SandboxStepBuilder();
    fn(sb);
    this._branches.push({
      type: "sequence",
      steps: [
        { type: "create_sandbox", entrypoint: ["tail", "-f", "/dev/null"], ...opts },
        ...sb.build(),
        { type: "delete_sandbox" },
      ],
    });
    return this;
  }

  branch(fn: (s: SandboxStepBuilder) => SandboxStepBuilder): this {
    const sb = new SandboxStepBuilder();
    fn(sb);
    this._branches.push(wrapSteps(sb.build()));
    return this;
  }

  build(): StepDef[] {
    return this._branches;
  }
}

// ── WorkflowBuilder ───────────────────────────────────────────────────────────

export class WorkflowBuilder {
  private _steps: StepDef[] = [];

  constructor(private _name: string) {}

  sandbox(opts: SandboxOpts, fn: (s: SandboxStepBuilder) => SandboxStepBuilder): this {
    const sb = new SandboxStepBuilder();
    fn(sb);
    this._steps.push(
      { type: "create_sandbox", entrypoint: ["tail", "-f", "/dev/null"], ...opts },
      ...sb.build(),
      { type: "delete_sandbox" },
    );
    return this;
  }

  parallel(fn: (p: WorkflowParallelBuilder) => WorkflowParallelBuilder): this {
    const pb = new WorkflowParallelBuilder();
    fn(pb);
    this._steps.push({ type: "parallel", steps: pb.build() });
    return this;
  }

  build(): { name: string; steps: StepDef[] } {
    return { name: this._name, steps: this._steps };
  }
}

export function workflow(name: string): WorkflowBuilder {
  return new WorkflowBuilder(name);
}
