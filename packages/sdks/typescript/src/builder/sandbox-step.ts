import type { StepDef, Predicate } from "@drej/core";
import { StepType, Encoding, Backoff } from "@drej/core";
import { CodeLanguage } from "@drej/opensandbox";
import type { FileInfo } from "@drej/opensandbox";
import { Ref, createLoopVar, wrapSteps, type LoopItem } from "./types";

export { CodeLanguage };

type ExecOpts = { cwd?: string; envs?: Record<string, string>; strict?: boolean; timeoutMs?: number };
type ForEachOpts = { concurrency?: number; as?: string };
type ForEachSource = unknown[] | { from: string } | Ref<any>;
type ForEachCallback = (s: SandboxStepBuilder, item: LoopItem) => void;

/**
 * Imperative builder for steps that run inside a sandbox.
 *
 * Use inside the callback of `workflow().sandbox(opts, (s) => { ... })`.
 * Methods that produce output (readFile, searchFiles, etc.) return a `Ref<T>`
 * you can use in subsequent steps via template literals.
 *
 * @example
 * ```ts
 * workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) => {
 *   s.exec("npm ci");
 *   const version = s.exec("node -e 'process.stdout.write(process.version)'", { capture: true });
 *   s.exec(`echo "Running on Node ${version}"`);
 * });
 * ```
 */
export class SandboxStepBuilder {
  protected _steps: StepDef[] = [];
  private _keyCounter = 0;

  private _nextKey(): string {
    return `_s${this._keyCounter++}`;
  }

  /**
   * Run a shell command inside the sandbox.
   *
   * Pass `{ capture: true }` to store stdout in workflow state — the returned
   * `Ref<string>` can be interpolated in subsequent steps via template literals.
   *
   * @example
   * ```ts
   * s.exec("npm ci");
   * const sha = s.exec("git rev-parse HEAD", { capture: true });
   * s.exec(`echo "deploying ${sha}"`);
   * s.exec("npm test", { strict: true });
   * ```
   */
  exec(command: string, opts: ExecOpts & { capture: true }): Ref<string>;
  exec(command: string, opts?: ExecOpts & { capture?: never }): this;
  exec(command: string, opts?: ExecOpts & { capture?: boolean }): this | Ref<string> {
    if (opts?.capture === true) {
      const key = this._nextKey();
      this._steps.push({
        type: StepType.ExecCommand,
        command,
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.envs ? { envs: opts.envs } : {}),
        capture: key,
        ...(opts.strict !== undefined ? { strict: opts.strict } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      });
      return new Ref<string>(key);
    }
    this._steps.push({
      type: StepType.ExecCommand,
      command,
      ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts?.envs ? { envs: opts.envs } : {}),
      ...(opts?.strict !== undefined ? { strict: opts.strict } : {}),
      ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
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
   * s.execCode("x = 42", { context: { id: "repl", language: CodeLanguage.Python } });
   * s.execCode("print(x)", { context: { id: "repl", language: CodeLanguage.Python } });
   * ```
   */
  execCode(code: string, opts?: { context?: { id: string; language: CodeLanguage }; timeoutMs?: number }): this {
    this._steps.push({ type: StepType.ExecCode, code, ...(opts?.context ? { context: opts.context } : {}), ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return this;
  }

  /**
   * Read a file from the sandbox filesystem into workflow state.
   * Returns a `Ref<string>` that resolves to the file content at runtime.
   *
   * @example
   * ```ts
   * s.exec("node -e 'console.log(42)' > /tmp/result.txt");
   * const result = s.readFile("/tmp/result.txt");
   * s.exec(`echo "Result was ${result}"`);
   * ```
   */
  readFile(path: string, opts?: { encoding?: Encoding; timeoutMs?: number }): Ref<string> {
    const key = this._nextKey();
    this._steps.push({ type: StepType.ReadFile, path, as: key, ...(opts?.encoding ? { encoding: opts.encoding } : {}), ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return new Ref<string>(key);
  }

  /**
   * Capture a snapshot of the sandbox at this point in the workflow.
   *
   * @example
   * ```ts
   * s.exec("npm ci");
   * s.snapshot();
   * s.exec("npm test");
   * ```
   */
  snapshot(): this {
    this._steps.push({ type: StepType.Snapshot });
    return this;
  }

  /**
   * Write a file into the sandbox filesystem.
   * Use template literals to embed `Ref` values: `` `${myRef}` ``.
   *
   * @example
   * ```ts
   * s.writeFile("/app/config.json", JSON.stringify(config));
   * s.writeFile("/app/data.bin", b64data, Encoding.Base64);
   * const version = s.exec("cat VERSION", { capture: true });
   * s.writeFile("/app/version.txt", `${version}`);
   * ```
   */
  writeFile(path: string, content: string, encoding?: Encoding, opts?: { timeoutMs?: number }): this {
    this._steps.push({ type: StepType.WriteFile, path, content, ...(encoding ? { encoding } : {}), ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return this;
  }

  /**
   * Retry a group of steps up to `maxAttempts` times on failure.
   *
   * @example
   * ```ts
   * s.retry(3, (r) => { r.exec("flaky-command"); }, { backoff: Backoff.Exponential });
   * ```
   */
  retry(
    maxAttempts: number,
    fn: (s: SandboxStepBuilder) => void,
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
   * const files = s.searchFiles("*.ts", { dir: "/src" });
   * s.forEach(files, (s, file) => { s.exec(`tsc --noEmit ${file}`); });
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
    callback(inner, loopVar);
    const steps = inner.build();

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
   * s.when({ op: "eq", field: "exitCode", value: 0 },
   *   (s) => { s.exec("echo success"); },
   *   (s) => { s.exec("echo failed"); },
   * );
   * ```
   */
  when(
    condition: Predicate,
    thenFn: (s: SandboxStepBuilder) => void,
    elseFn?: (s: SandboxStepBuilder) => void,
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
   * s.deleteFile("/tmp/build.log");
   * ```
   */
  deleteFile(path: string, opts?: { timeoutMs?: number }): this {
    this._steps.push({ type: StepType.DeleteFile, path, ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return this;
  }

  /**
   * Move or rename a file inside the sandbox filesystem.
   *
   * @example
   * ```ts
   * s.moveFile("/app/dist", "/app/release");
   * ```
   */
  moveFile(from: string, to: string, opts?: { timeoutMs?: number }): this {
    this._steps.push({ type: StepType.MoveFile, from, to, ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return this;
  }

  /**
   * List a directory inside the sandbox and store the entries in workflow state.
   * Returns a `Ref<FileInfo[]>` usable in `forEach` or template literals.
   *
   * @example
   * ```ts
   * const entries = s.listDirectory("/app/dist");
   * s.forEach(entries, (s, entry) => { s.exec(`echo ${entry}`); });
   * ```
   */
  listDirectory(path: string, opts?: { depth?: number; timeoutMs?: number }): Ref<FileInfo[]> {
    const key = this._nextKey();
    this._steps.push({ type: StepType.ListDirectory, path, as: key, ...(opts?.depth !== undefined ? { depth: opts.depth } : {}), ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return new Ref<FileInfo[]>(key);
  }

  /**
   * Search for files matching a glob pattern and store the matching paths in workflow state.
   * Returns a `Ref<string[]>` usable in `forEach` or template literals.
   *
   * @example
   * ```ts
   * const tsFiles = s.searchFiles("**\/*.ts", { dir: "/src" });
   * s.forEach(tsFiles, (s, file) => { s.exec(`tsc --noEmit ${file}`); });
   * ```
   */
  searchFiles(pattern: string, opts?: { dir?: string; timeoutMs?: number }): Ref<string[]> {
    const key = this._nextKey();
    this._steps.push({ type: StepType.SearchFiles, pattern, as: key, ...(opts?.dir !== undefined ? { dir: opts.dir } : {}), ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return new Ref<string[]>(key);
  }

  /**
   * Create a directory inside the sandbox filesystem.
   *
   * @example
   * ```ts
   * s.createDirectory("/app/logs");
   * ```
   */
  createDirectory(path: string, opts?: { timeoutMs?: number }): this {
    this._steps.push({ type: StepType.CreateDirectory, path, ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return this;
  }

  /**
   * Recursively delete a directory inside the sandbox filesystem.
   *
   * @example
   * ```ts
   * s.deleteDirectory("/app/dist");
   * ```
   */
  deleteDirectory(path: string, opts?: { timeoutMs?: number }): this {
    this._steps.push({ type: StepType.DeleteDirectory, path, ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return this;
  }

  /**
   * Set file permissions inside the sandbox.
   *
   * @example
   * ```ts
   * s.setPermissions("/app/entrypoint.sh", "755");
   * ```
   */
  setPermissions(path: string, mode: string, opts?: { timeoutMs?: number }): this {
    this._steps.push({ type: StepType.SetPermissions, path, mode, ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return this;
  }

  /**
   * Perform batch text replacements across one or more files.
   * Use template literals to embed `Ref` values: `` `${myRef}` ``.
   *
   * @example
   * ```ts
   * s.replaceInFiles([{ path: "/app/version.txt", old: "0.0.0", new: "1.2.3" }]);
   * ```
   */
  replaceInFiles(replacements: Array<{ path: string; old: string; new: string }>, opts?: { timeoutMs?: number }): this {
    this._steps.push({ type: StepType.ReplaceInFiles, replacements, ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return this;
  }

  /**
   * Fetch metadata about a file and store it in workflow state.
   * Returns a `Ref<FileInfo>` with `path`, `size`, `mode`, `type`, etc.
   *
   * @example
   * ```ts
   * const info = s.getFileInfo("/app/bundle.js");
   * s.exec(`echo "size: ${info}"`);
   * ```
   */
  getFileInfo(path: string, opts?: { timeoutMs?: number }): Ref<FileInfo> {
    const key = this._nextKey();
    this._steps.push({ type: StepType.GetFileInfo, path, as: key, ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
    return new Ref<FileInfo>(key);
  }

  /**
   * Run multiple branches concurrently inside the same sandbox.
   *
   * @example
   * ```ts
   * s.parallel((p) => {
   *   p.branch((b) => { b.exec("lint"); });
   *   p.branch((b) => { b.exec("test"); });
   * });
   * ```
   */
  parallel(fn: (p: SandboxParallelBuilder) => void, opts?: { concurrency?: number }): this {
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
