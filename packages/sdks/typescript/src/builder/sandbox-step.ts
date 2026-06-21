import type { StepDef, Predicate } from "@drej/core";
import { CodeLanguage } from "@drej/opensandbox";
import { createLoopVar, wrapSteps, type LoopItem } from "./types";

export { CodeLanguage };

type ForEachOpts = { concurrency?: number; as?: string };
type ForEachSource = unknown[] | { from: string };
type ForEachCallback = (s: SandboxStepBuilder, item: LoopItem) => SandboxStepBuilder | string;

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
   *   code. When `false` (default), the exit code is stored in state as `exitCode`.
   *
   * @example
   * ```ts
   * s.exec("npm ci").exec("npm test")
   * s.exec("git rev-parse HEAD", { capture: "sha" }).exec("echo deploying {{sha}}")
   * s.exec("npm test", { strict: true })
   * ```
   */
  exec(command: string, opts?: { cwd?: string; envs?: Record<string, string>; capture?: string; strict?: boolean }): this {
    this._steps.push({ type: "exec_command", command, ...opts });
    return this;
  }

  /**
   * Execute code inside the sandbox using a stateful interpreter context.
   *
   * **Requires** the `opensandbox/code-interpreter` image.
   *
   * @example
   * ```ts
   * s.execCode("x = 42", { context: { id: "repl", language: CodeLanguage.Python } })
   * s.execCode("print(x)", { context: { id: "repl", language: CodeLanguage.Python } })
   * ```
   */
  execCode(code: string, opts?: { context?: { id: string; language: CodeLanguage } }): this {
    this._steps.push({ type: "exec_code", code, ...(opts?.context ? { context: opts.context } : {}) });
    return this;
  }

  /**
   * Read a file from the sandbox filesystem into workflow state.
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
   * @example
   * ```ts
   * s.exec("npm ci").snapshot().exec("npm test")
   * ```
   */
  snapshot(): this {
    this._steps.push({ type: "snapshot" });
    return this;
  }

  /**
   * Write a file into the sandbox filesystem.
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
    const loopVar = createLoopVar(varName);
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
      ...(opts.concurrency !== undefined && opts.concurrency > 1 ? { maxConcurrency: opts.concurrency } : {}),
    });

    return this;
  }

  /**
   * Conditionally execute steps based on a predicate evaluated at runtime.
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
   *
   * @example
   * ```ts
   * s.parallel((p) => p
   *   .branch((b) => b.exec("lint"))
   *   .branch((b) => b.exec("test")),
   * )
   * ```
   */
  parallel(fn: (p: SandboxParallelBuilder) => SandboxParallelBuilder, opts?: { concurrency?: number }): this {
    const pb = new SandboxParallelBuilder();
    fn(pb);
    this._steps.push({ type: "parallel", steps: pb.build(), ...(opts?.concurrency ? { maxConcurrency: opts.concurrency } : {}) });
    return this;
  }

  build(): StepDef[] {
    return [...this._steps];
  }
}

export class SandboxParallelBuilder {
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
