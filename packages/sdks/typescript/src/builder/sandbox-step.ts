import type { StepDef, Predicate } from "@drej/core";
import { StepType, Encoding, Backoff } from "@drej/core";
import { CodeLanguage } from "@drej/opensandbox";
import { createLoopVar, wrapSteps, refKey, refStr, Ref, type LoopItem } from "./types";

export { CodeLanguage };

type ForEachOpts = { concurrency?: number; as?: string };
type ForEachSource = unknown[] | { from: string } | Ref<unknown[]>;
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
  exec(command: string, opts?: { cwd?: string; envs?: Record<string, Ref<string> | string>; capture?: Ref<string> | string; strict?: boolean }): this {
    this._steps.push({
      type: StepType.ExecCommand,
      command,
      ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts?.envs ? { envs: Object.fromEntries(Object.entries(opts.envs).map(([k, v]) => [k, refStr(v)])) } : {}),
      ...(opts?.capture !== undefined ? { capture: refKey(opts.capture) } : {}),
      ...(opts?.strict !== undefined ? { strict: opts.strict } : {}),
    });
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
    this._steps.push({ type: StepType.ExecCode, code, ...(opts?.context ? { context: opts.context } : {}) });
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
  readFile(path: string, opts: { as: Ref<string> | string; encoding?: Encoding }): this {
    this._steps.push({ type: StepType.ReadFile, path, as: refKey(opts.as), ...(opts.encoding ? { encoding: opts.encoding } : {}) });
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
    this._steps.push({ type: StepType.Snapshot });
    return this;
  }

  /**
   * Write a file into the sandbox filesystem.
   *
   * @example
   * ```ts
   * s.writeFile("/app/config.json", JSON.stringify(config))
   * s.writeFile("/app/data.bin", b64data, Encoding.Base64)
   * ```
   */
  writeFile(path: string, content: Ref<string> | string, encoding?: Encoding): this {
    this._steps.push({ type: StepType.WriteFile, path, content: refStr(content), ...(encoding ? { encoding } : {}) });
    return this;
  }

  /**
   * Retry a group of steps up to `maxAttempts` times on failure.
   *
   * @example
   * ```ts
   * s.retry(3, (r) => r.exec("flaky-command"), { backoff: Backoff.Exponential })
   * ```
   */
  retry(
    maxAttempts: number,
    fn: (s: SandboxStepBuilder) => SandboxStepBuilder,
    opts?: { delayMs?: number; backoff?: Backoff },
  ): this {
    const inner = new SandboxStepBuilder();
    fn(inner);
    this._steps.push({ type: StepType.Retry, step: wrapSteps(inner.build()), maxAttempts, ...opts });
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
        ? [{ type: StepType.ExecCommand, command: result }]
        : result.build();

    const over = Array.isArray(source) ? { items: source }
      : source instanceof Ref ? { over: source.key }
      : { over: (source as { from: string }).from };
    this._steps.push({
      type: StepType.Loop,
      as: varName,
      steps,
      ...over,
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
      type: StepType.Conditional,
      condition,
      then: thenBuilder.build(),
      ...(elseSteps ? { else: elseSteps } : {}),
    });

    return this;
  }

  /**
   * Delete a file from the sandbox filesystem.
   *
   * @example
   * ```ts
   * s.deleteFile("/tmp/build.log")
   * s.deleteFile(`/tmp/${sha}.tar.gz`)
   * ```
   */
  deleteFile(path: string): this {
    this._steps.push({ type: StepType.DeleteFile, path });
    return this;
  }

  /**
   * Move or rename a file inside the sandbox filesystem.
   *
   * @example
   * ```ts
   * s.moveFile("/app/dist", "/app/release")
   * s.moveFile(`/tmp/${sha}`, "/app/current")
   * ```
   */
  moveFile(from: string, to: string): this {
    this._steps.push({ type: StepType.MoveFile, from, to });
    return this;
  }

  /**
   * List a directory inside the sandbox and store the entries in workflow state.
   *
   * @example
   * ```ts
   * const entries = ref<DirectoryEntry[]>("entries")
   * s.listDirectory("/app/dist", { as: entries })
   *  .forEach(entries, (s, entry) => s.exec(`echo ${entry}`))
   * ```
   */
  listDirectory(path: string, opts: { as: Ref<unknown[]> | string; depth?: number }): this {
    this._steps.push({ type: StepType.ListDirectory, path, as: refKey(opts.as), ...(opts.depth !== undefined ? { depth: opts.depth } : {}) });
    return this;
  }

  /**
   * Search for files matching a glob pattern and store the matching paths in workflow state.
   * The result is a `string[]` that can be passed directly to `forEach`.
   *
   * @example
   * ```ts
   * const tsFiles = ref<string[]>("tsFiles")
   * s.searchFiles("**\/*.ts", { as: tsFiles })
   *  .forEach(tsFiles, (s, file) => s.exec(`tsc --noEmit ${file}`))
   * ```
   */
  searchFiles(pattern: string, opts: { as: Ref<string[]> | string; dir?: string }): this {
    this._steps.push({ type: StepType.SearchFiles, pattern, as: refKey(opts.as), ...(opts.dir !== undefined ? { dir: opts.dir } : {}) });
    return this;
  }

  /**
   * Create a directory inside the sandbox filesystem.
   *
   * @example
   * ```ts
   * s.createDirectory("/app/logs")
   * ```
   */
  createDirectory(path: string): this {
    this._steps.push({ type: StepType.CreateDirectory, path });
    return this;
  }

  /**
   * Recursively delete a directory inside the sandbox filesystem.
   *
   * @example
   * ```ts
   * s.deleteDirectory("/app/dist")
   * ```
   */
  deleteDirectory(path: string): this {
    this._steps.push({ type: StepType.DeleteDirectory, path });
    return this;
  }

  /**
   * Set file permissions inside the sandbox.
   *
   * @example
   * ```ts
   * s.setPermissions("/app/entrypoint.sh", "755")
   * ```
   */
  setPermissions(path: string, mode: string): this {
    this._steps.push({ type: StepType.SetPermissions, path, mode });
    return this;
  }

  /**
   * Perform batch text replacements across one or more files.
   * All `path`, `old`, and `new` fields support `{{key}}` interpolation and `Ref` values.
   *
   * @example
   * ```ts
   * const sha = ref<string>("sha")
   * s.replaceInFiles([
   *   { path: "/app/version.txt", old: "0.0.0", new: sha },
   * ])
   * ```
   */
  replaceInFiles(replacements: Array<{ path: string; old: Ref<string> | string; new: Ref<string> | string }>): this {
    this._steps.push({
      type: StepType.ReplaceInFiles,
      replacements: replacements.map((r) => ({ path: r.path, old: refStr(r.old), new: refStr(r.new) })),
    });
    return this;
  }

  /**
   * Fetch metadata about a file and store it in workflow state.
   * The result is a `FileInfo` object with `path`, `size`, `mode`, `modifiedAt`, and `isDirectory`.
   *
   * @example
   * ```ts
   * const info = ref("info")
   * s.getFileInfo("/app/bundle.js", { as: info })
   * ```
   */
  getFileInfo(path: string, opts: { as: Ref<unknown> | string }): this {
    this._steps.push({ type: StepType.GetFileInfo, path, as: refKey(opts.as) });
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
    this._steps.push({ type: StepType.Parallel, steps: pb.build(), ...(opts?.concurrency ? { maxConcurrency: opts.concurrency } : {}) });
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
