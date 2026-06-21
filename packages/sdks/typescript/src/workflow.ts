import type { StepDef, Predicate } from "@drej/core";
import { validateWorkflow } from "@drej/core";
import type { ImageSpec, Resources, Sandbox } from "@drej/opensandbox";

// Placeholder that serialises to {{name}} inside template literals.
// Used as the `item` parameter in forEach callbacks so users write
// `s.exec(`upload ${item}`)` instead of `s.exec("upload {{item}}")`.
class LoopVar {
  constructor(private name: string) {}
  toString() {
    return `{{${this.name}}}`;
  }
}

/** Represents the current loop variable inside a `forEach` callback. Serialises to `{{name}}`. */
export type LoopItem = { toString(): string };

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

type ForEachOpts = {
  concurrency?: number;
  as?: string;
};

type ForEachSource = unknown[] | { from: string };
type ForEachCallback = (s: SandboxStepBuilder, item: LoopItem) => SandboxStepBuilder | string;

function wrapSteps(steps: StepDef[]): StepDef {
  return steps.length === 1 ? steps[0] : { type: "sequence", steps };
}

/**
 * Fluent builder for steps that run inside a sandbox.
 * Returned by the callback in `workflow().sandbox(opts, s => s.exec(...))`.
 */
export class SandboxStepBuilder {
  protected _steps: StepDef[] = [];

  /**
   * Run a shell command inside the sandbox.
   *
   * @param opts.capture Store stdout in workflow state under this key, making it
   *   available for interpolation in subsequent steps via `{{key}}`.
   * @param opts.strict Throw a `CommandError` if the command exits with a non-zero
   *   code. When `false` (default), the exit code is stored in state as `exitCode`
   *   and the workflow continues — use `when({ field: "exitCode", eq: 0 }, ...)` to branch.
   *
   * @example
   * ```ts
   * s.exec("npm ci").exec("npm test")
   * s.exec("python script.py", { cwd: "/app" })
   * s.exec("git rev-parse HEAD", { capture: "sha" }).exec("echo deploying {{sha}}")
   * s.exec("npm test", { strict: true }) // throws CommandError on non-zero exit
   * ```
   */
  exec(command: string, opts?: { cwd?: string; envs?: Record<string, string>; capture?: string; strict?: boolean }): this {
    this._steps.push({ type: "exec_command", command, ...opts });
    return this;
  }

  /**
   * Execute code inside the sandbox using a stateful interpreter context.
   *
   * **Requires** the `opensandbox/code-interpreter` image with entrypoint
   * `["/opt/code-interpreter/code-interpreter.sh"]`. Supported languages:
   * Python, Node.js, Java, Go, Bash.
   *
   * @param context.id        Reuse a named context across calls to share state (variables, imports).
   * @param context.language  Language identifier (e.g. `"python"`, `"node"`).
   *
   * @example
   * ```ts
   * // Stateless one-shot execution
   * s.execCode("print('hello')")
   *
   * // Stateful session: second call sees x defined by the first
   * s.execCode("x = 42", { context: { id: "repl", language: "python" } })
   * s.execCode("print(x)", { context: { id: "repl", language: "python" } })
   * ```
   */
  execCode(code: string, opts?: { context?: { id: string; language: string } }): this {
    this._steps.push({ type: "exec_code", code, ...(opts?.context ? { context: opts.context } : {}) });
    return this;
  }

  /**
   * Read a file from the sandbox filesystem into workflow state.
   *
   * The file contents are stored under `as` and available for interpolation
   * in subsequent steps via `{{key}}`, or accessible on `WorkflowState` after
   * the run completes.
   *
   * @param encoding Defaults to `utf8`. Use `base64` for binary files.
   *
   * @example
   * ```ts
   * s.exec("node -e 'console.log(42)' > /tmp/result.txt")
   *  .readFile("/tmp/result.txt", { as: "result" })
   *  .exec("echo Result was {{result}}")
   * ```
   */
  readFile(path: string, opts: { as: string; encoding?: "utf8" | "base64" }): this {
    this._steps.push({ type: "read_file", path, as: opts.as, ...(opts.encoding ? { encoding: opts.encoding } : {}) });
    return this;
  }

  /**
   * Capture a snapshot of the sandbox at this point in the workflow.
   *
   * The snapshot ID is stored in workflow state as `snapshotId` and persisted
   * to the ledger. Use {@link DrejClient.replayFromSnapshot} to boot a future
   * run from this checkpoint, skipping any steps that ran before it.
   *
   * @example
   * ```ts
   * workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
   *   s.exec("npm ci")
   *    .snapshot()          // checkpoint after deps installed
   *    .exec("npm test"),
   * )
   * ```
   */
  snapshot(): this {
    this._steps.push({ type: "snapshot" });
    return this;
  }

  /**
   * Write a file into the sandbox filesystem.
   *
   * @param encoding Defaults to `utf8`. Use `base64` for binary content.
   *
   * @example
   * ```ts
   * s.writeFile("/app/config.json", JSON.stringify(config))
   * ```
   */
  writeFile(path: string, content: string, encoding?: "utf8" | "base64"): this {
    this._steps.push({ type: "write_file", path, content, ...(encoding ? { encoding } : {}) });
    return this;
  }

  /**
   * Retry a group of steps up to `maxAttempts` times on failure.
   *
   * @example
   * ```ts
   * s.retry(3, (r) => r.exec("flaky-command"), { backoff: "exponential" })
   * ```
   */
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

  /**
   * Iterate over a list and run steps for each item.
   *
   * @param source An array literal, or `{ from: "prevStepOutputKey" }` to read
   *   the list from a previous step's output at runtime.
   * @param opts.concurrency Run up to N iterations in parallel.
   * @param opts.as Variable name to use inside the callback (default: `"item"`).
   *
   * @example
   * ```ts
   * s.forEach(["a.txt", "b.txt"], (s, item) => s.exec(`cat ${item}`))
   * s.forEach({ from: "files" }, { concurrency: 4 }, (s, item) => s.exec(`process ${item}`))
   * ```
   */
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

  /**
   * Conditionally execute steps based on a predicate evaluated at runtime.
   *
   * @param condition A predicate object (e.g. `{ field: "exitCode", eq: 0 }`).
   *
   * @example
   * ```ts
   * s.when({ field: "exitCode", eq: 0 },
   *   (s) => s.exec("echo success"),
   *   (s) => s.exec("echo failed"),
   * )
   * ```
   */
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

  /**
   * Run multiple branches concurrently inside the same sandbox.
   * All branches share the sandbox filesystem and environment.
   *
   * @example
   * ```ts
   * s.parallel((p) => p
   *   .branch((b) => b.exec("lint"))
   *   .branch((b) => b.exec("test")),
   * )
   * ```
   */
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

  sandbox(optsOrSandbox: SandboxOpts | Sandbox, fn: (s: SandboxStepBuilder) => SandboxStepBuilder): this {
    const sb = new SandboxStepBuilder();
    fn(sb);
    const innerSteps = sb.build();
    this._branches.push({
      type: "sequence",
      steps: "id" in optsOrSandbox
        ? innerSteps
        : [{ type: "create_sandbox", entrypoint: ["tail", "-f", "/dev/null"], ...optsOrSandbox }, ...innerSteps],
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
   * The sandbox is NOT deleted when the workflow completes — call
   * `client.deleteSandbox(id)` explicitly when you are done with it.
   *
   * @example
   * ```ts
   * // Create a fresh sandbox for this workflow
   * workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
   *   s.exec("npm ci").exec("npm test"),
   * )
   *
   * // Reuse an existing sandbox
   * const sb = await client.createSandbox({ image: { uri: "node:20-slim" } });
   * workflow("build").sandbox(sb, (s) => s.exec("npm test"))
   * await client.deleteSandbox(sb.id);
   * ```
   */
  sandbox(optsOrSandbox: SandboxOpts | Sandbox, fn: (s: SandboxStepBuilder) => SandboxStepBuilder): this {
    const sb = new SandboxStepBuilder();
    fn(sb);
    if ("id" in optsOrSandbox) {
      this._initialState.sandboxId = optsOrSandbox.id;
      this._steps.push(...sb.build());
    } else {
      this._steps.push(
        { type: "create_sandbox", entrypoint: ["tail", "-f", "/dev/null"], ...optsOrSandbox },
        ...sb.build(),
      );
    }
    return this;
  }

  parallel(fn: (p: WorkflowParallelBuilder) => WorkflowParallelBuilder): this {
    const pb = new WorkflowParallelBuilder();
    fn(pb);
    this._steps.push({ type: "parallel", steps: pb.build() });
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
 * The name is used as the storage key for the run ledger — use a stable,
 * descriptive name (e.g. `"deploy-api"`, `"nightly-report"`).
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
