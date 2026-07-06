import { Drej } from "drej";
import type { IStorageAdapter, Sandbox } from "@drej/core";
import { readProjectConfig } from "./config";
import { validateAgentSpec, type AgentSpec } from "./schema";
import { PiAdapter, resolveEnv, toShellExports } from "./adapters/pi";
import {
  AgentSnapshotStore,
  computeSetupHash,
  snapshotsPath,
  type AgentSnapshotRecord,
} from "./snapshots";
import type {
  AgentStream,
  CompactResult,
  PiMessage,
  PiModel,
  PiSessionState,
  PiSlashCommand,
  SessionStats,
  ThinkingLevel,
} from "./types";

function elapsed(t: number) {
  return `${Date.now() - t}ms`;
}

/**
 * A live AI coding agent running inside an OpenSandbox container.
 *
 * Wraps a Pi CLI process (`pi --mode rpc --approve`) in an HTTP bridge so the
 * host can send prompts and receive streamed responses over a stable API,
 * while Pi manages its own tool use, file writes, and code execution inside the
 * sandbox.
 *
 * Create an agent with `Agent.load(specPath)`. Always call `close()` when done
 * to release the underlying sandbox container.
 *
 * @example
 * ```ts
 * import { Agent } from "@drej/agent";
 *
 * const agent = await Agent.load("./agents/my-agent.json");
 * try {
 *   for await (const chunk of agent.prompt("Explain this codebase")) {
 *     process.stdout.write(chunk);
 *   }
 * } finally {
 *   await agent.close();
 * }
 * ```
 */
export class Agent {
  /** OpenSandbox container ID for this agent's sandbox. */
  readonly sandboxId: string;
  readonly name: string;
  /**
   * Direct access to the underlying `Sandbox` — full drej Sandbox API, bypasses Pi.
   * Use this to read or write files, run shell commands, or inspect container state
   * independently of the Pi conversation.
   */
  readonly sandbox: Sandbox;
  /**
   * `true` when this agent was loaded from a cached snapshot (fast path).
   * `false` on the first load for a given spec, or after `{ rebuild: true }`.
   */
  readonly fromSnapshot: boolean;

  private readonly _adapter: PiAdapter;
  private _env: Record<string, string>;

  private constructor(
    sandbox: Sandbox,
    spec: AgentSpec,
    env: Record<string, string>,
    adapter: PiAdapter,
    fromSnapshot: boolean,
  ) {
    this.sandbox = sandbox;
    this.sandboxId = sandbox.sandboxId;
    this.name = spec.name;
    this._adapter = adapter;
    this._env = env;
    this.fromSnapshot = fromSnapshot;
  }

  /**
   * Load an agent spec from disk and return a fully initialised `Agent`.
   *
   * On first load the Pi CLI is installed inside a `node:22` sandbox, then
   * the sandbox is checkpointed. Subsequent `load()` calls for the same spec
   * restore from that snapshot — skipping the install and starting in ~3s instead
   * of ~90s.
   *
   * Pass `{ rebuild: true }` to force a full reinstall (e.g. after changing
   * the spec's `packages` or `cliVersion`).
   *
   * Logs timing for each phase to stdout via `[agent]` prefixed lines.
   */
  static async load(
    specPath: string,
    opts: { adapter: IStorageAdapter; rebuild?: boolean },
  ): Promise<Agent> {
    const t0 = Date.now();
    const spec = validateAgentSpec(await Bun.file(specPath).json());
    const config = await readProjectConfig();
    const resolvedEnv = resolveEnv(spec.env ?? {});
    const resources = { ...config.defaults.resources, ...(spec.resources ?? {}) };

    const client = new Drej({
      baseUrl: config.serverUrl,
      apiKey: config.apiKey,
      adapter: opts.adapter,
      useServerProxy: config.useServerProxy,
    });

    const store = new AgentSnapshotStore(snapshotsPath(config.adapterPath));
    const setupHash = computeSetupHash(spec);

    const adapter = new PiAdapter();
    let sb: Sandbox;
    let fromSnapshot = false;

    // ── Snapshot fast path ────────────────────────────────────────────────────
    if (!opts.rebuild) {
      const record = await store.get(spec.name, setupHash);
      if (record) {
        try {
          console.log(`[agent] restoring from snapshot...`);
          const t1 = Date.now();
          sb = await client.restoreSnapshot(record.snapshotId, spec.name, resources);
          console.log(`[agent] snapshot ready  ${elapsed(t1)} (${sb.sandboxId})`);
          fromSnapshot = true;
        } catch {
          console.log(`[agent] snapshot stale, rebuilding...`);
          await store.delete(spec.name);
        }
      }
    }

    // ── Full install path ─────────────────────────────────────────────────────
    if (!fromSnapshot) {
      console.log(`[agent] starting sandbox (${spec.name})...`);
      const t1 = Date.now();
      sb = await client.sandbox({
        image: "node:22",
        resources,
        name: spec.name,
        env: resolvedEnv,
      });
      console.log(`[agent] sandbox ready   ${elapsed(t1)} (${sb.sandboxId})`);

      console.log(`[agent] installing Pi CLI...`);
      const t2 = Date.now();
      await adapter.install(sb!, spec);
      console.log(`[agent] Pi CLI ready    ${elapsed(t2)}`);

      for (const step of spec.setup ?? []) {
        console.log(`[agent] setup: ${step.name}...`);
        const ts = Date.now();
        const cmd = step.cwd ? `cd ${step.cwd} && ${step.run}` : step.run;
        await sb!.exec(cmd);
        console.log(`[agent] setup done      ${elapsed(ts)} (${step.name})`);
      }

      console.log(`[agent] checkpointing...`);
      const t3 = Date.now();
      const snapshotId = await sb!.checkpoint();
      await store.save({
        specName: spec.name,
        setupHash,
        snapshotId,
        createdAt: Date.now(),
      });
      console.log(`[agent] checkpoint done ${elapsed(t3)}`);
    }

    // ── Always: write fresh config + start bridge ─────────────────────────────
    await adapter.configure(sb!, spec, resolvedEnv);

    console.log(`[agent] starting bridge...`);
    const t4 = Date.now();
    await adapter.startBridge(sb!);
    await adapter.waitReady();
    console.log(`[agent] bridge ready    ${elapsed(t4)}`);
    console.log(`[agent] total           ${elapsed(t0)}${fromSnapshot ? " (from snapshot)" : ""}`);

    return new Agent(sb!, spec, resolvedEnv, adapter, fromSnapshot);
  }

  /**
   * Reconnect to a previously-created agent whose host process has exited.
   *
   * The sandbox container must still be running. Pi and any installed packages
   * are already present — only the bridge process needs to be restarted.
   * Pi is started with `--continue` so it resumes the most recent session.
   *
   * @param sandboxId  The sandbox ID returned by the original `Agent.load()`.
   * @param opts.specPath  Path to the agent spec JSON. If omitted, the ledger
   *   is queried for the sandbox name and the spec is loaded from
   *   `./agents/<name>.json`.
   *
   * @example
   * ```ts
   * // Original process:
   * const agent = await Agent.load("./agents/hello-agent.json", { adapter });
   * console.log(agent.sandboxId); // save this
   * // ... process exits ...
   *
   * // New process:
   * const agent = await Agent.resume(savedSandboxId, { adapter });
   * for await (const chunk of agent.prompt("What did we discuss earlier?")) {
   *   process.stdout.write(chunk);
   * }
   * await agent.close();
   * ```
   */
  static async resume(
    sandboxId: string,
    opts: { adapter: IStorageAdapter; specPath?: string },
  ): Promise<Agent> {
    const t0 = Date.now();
    const config = await readProjectConfig();

    const client = new Drej({
      baseUrl: config.serverUrl,
      apiKey: config.apiKey,
      adapter: opts.adapter,
      useServerProxy: config.useServerProxy,
    });

    let spec: AgentSpec;
    if (opts.specPath) {
      spec = validateAgentSpec(await Bun.file(opts.specPath).json());
    } else {
      const sessions = await client.sandboxes.list();
      const session = sessions.find((s) => s.sandboxId === sandboxId);
      if (!session)
        throw new Error(
          `No ledger record for sandbox ${sandboxId} — pass opts.specPath explicitly`,
        );
      spec = validateAgentSpec(await Bun.file(`./agents/${session.name}.json`).json());
    }

    const resolvedEnv = resolveEnv(spec.env ?? {});

    console.log(`[agent] reconnecting to ${sandboxId}...`);
    const t1 = Date.now();
    const sb = await client.connect(sandboxId, spec.name);
    console.log(`[agent] connected       ${elapsed(t1)}`);

    // Kill any stale bridge process before starting a fresh one.
    await sb.exec("pkill -f 'node /drej-bridge.js' 2>/dev/null; sleep 0.1; true", {
      strict: false,
    });

    const adapter = new PiAdapter();
    await adapter.configure(sb, spec, resolvedEnv, { resume: true });

    console.log(`[agent] starting bridge...`);
    const t2 = Date.now();
    await adapter.startBridge(sb);
    await adapter.waitReady();
    console.log(`[agent] bridge ready    ${elapsed(t2)}`);
    console.log(`[agent] total           ${elapsed(t0)}`);

    return new Agent(sb, spec, resolvedEnv, adapter, false);
  }

  // --- streaming ---

  /** Send a prompt to Pi and stream the response. Pi manages its own session context. */
  prompt(message: string, opts?: { streamingBehavior?: "steer" | "followUp" }): AgentStream {
    return this._adapter.prompt(message, opts);
  }

  /**
   * Run a shell command inside Pi's working context. Not incrementally
   * streamed — Pi returns bash output synchronously, so the full output
   * arrives as a single `text` event once the command completes.
   */
  bash(command: string): AgentStream {
    return this._adapter.bash(command);
  }

  // --- ack-only commands ---

  /** Steer Pi's current response mid-flight. Waits for Pi's RPC acknowledgment. */
  async steer(message: string): Promise<void> {
    return this._adapter.steer(message);
  }

  /** Abort Pi's current operation. */
  async abort(): Promise<void> {
    return this._adapter.abort();
  }

  /** Queue a message to be sent to Pi after it finishes its current task. */
  async followUp(message: string): Promise<void> {
    return this._adapter.followUp(message);
  }

  /** Start a fresh Pi session, clearing all prior context. */
  async newSession(): Promise<void> {
    return this._adapter.newSession();
  }

  /** Set Pi's reasoning level (for models that support extended thinking). */
  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    return this._adapter.setThinkingLevel(level);
  }

  /** Enable or disable Pi's automatic context compaction. */
  async setAutoCompaction(enabled: boolean): Promise<void> {
    return this._adapter.setAutoCompaction(enabled);
  }

  /**
   * Enable or disable Pi's automatic retry on transient errors (429, 500, 502, 503, 504).
   * Auto-retry is ON by default: 3 attempts with exponential backoff (2 s / 4 s / 8 s).
   * Disable it when you want to handle errors yourself via `auto_retry_start`/`auto_retry_end`
   * events in the stream.
   */
  async setAutoRetry(enabled: boolean): Promise<void> {
    return this._adapter.setAutoRetry(enabled);
  }

  /**
   * Abort an in-progress auto-retry immediately. Pi stops waiting and fails the current
   * operation, emitting `auto_retry_end` with `success: false`.
   */
  async abortRetry(): Promise<void> {
    return this._adapter.abortRetry();
  }

  /** Abort a currently-executing bash command without cancelling the whole prompt. */
  async abortBash(): Promise<void> {
    return this._adapter.abortBash();
  }

  /** Retrieve token usage, cost, and message counts for the current session. */
  async getSessionStats(): Promise<SessionStats> {
    return this._adapter.getSessionStats();
  }

  /** Retrieve the text of Pi's most recent assistant response. Returns `null` if none yet. */
  async getLastAssistantText(): Promise<string | null> {
    return this._adapter.getLastAssistantText();
  }

  /**
   * List the fork entry points available in the current session.
   * Each entry has `entryId` (pass to `fork()`) and `text` (the message at that point).
   */
  async getForkMessages(): Promise<{ entryId: string; text: string }[]> {
    return this._adapter.getForkMessages();
  }

  /** List Pi's available slash commands, including extensions, prompt templates, and skills. */
  async getCommands(): Promise<PiSlashCommand[]> {
    return this._adapter.getCommands();
  }

  /** Set a display name for the current Pi session. */
  async setSessionName(name: string): Promise<void> {
    return this._adapter.setSessionName(name);
  }

  /**
   * Control how Pi processes queued steering messages.
   * `"all"` applies all queued steers at once; `"one-at-a-time"` applies them sequentially.
   */
  async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return this._adapter.setSteeringMode(mode);
  }

  /**
   * Control how Pi processes queued follow-up messages.
   * `"all"` sends all queued follow-ups at once; `"one-at-a-time"` sends them sequentially.
   */
  async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return this._adapter.setFollowUpMode(mode);
  }

  /**
   * Export a static HTML transcript of the current session to the sandbox filesystem.
   * Returns the container path of the generated file — use `agent.sandbox.readFile(path)`
   * to retrieve it.
   */
  async exportHtml(outputPath?: string): Promise<{ path: string }> {
    return this._adapter.exportHtml(outputPath);
  }

  // --- commands that return data ---

  /**
   * Fork Pi's session at the given entry ID, creating a new branch.
   * Returns the text of the forked message and whether the fork was cancelled.
   */
  async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
    return this._adapter.fork(entryId);
  }

  /** Clone the current Pi session into a new branch at the current position. */
  async clone(): Promise<{ cancelled: boolean }> {
    return this._adapter.clone();
  }

  /** Switch Pi to a different session file on disk. */
  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    return this._adapter.switchSession(sessionPath);
  }

  /** Switch Pi to a specific model. Returns the activated model. */
  async setModel(provider: string, modelId: string): Promise<PiModel> {
    return this._adapter.setModel(provider, modelId);
  }

  /** Cycle Pi to the next available model. Returns null if only one model is configured. */
  async cycleModel(): Promise<{
    model: PiModel;
    thinkingLevel: ThinkingLevel;
    isScoped: boolean;
  } | null> {
    return this._adapter.cycleModel();
  }

  /** Cycle Pi's thinking level. Returns null if the current model doesn't support thinking. */
  async cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null> {
    return this._adapter.cycleThinkingLevel();
  }

  /** Manually trigger Pi's context compaction. */
  async compact(customInstructions?: string): Promise<CompactResult> {
    return this._adapter.compact(customInstructions);
  }

  /** Retrieve Pi's full conversation history for the current session. */
  async getMessages(): Promise<PiMessage[]> {
    return this._adapter.getMessages();
  }

  /** List all models available to Pi under the current provider configuration. */
  async getAvailableModels(): Promise<PiModel[]> {
    return this._adapter.getAvailableModels();
  }

  /**
   * Retrieve Pi's current session state: active model, thinking level, streaming/compaction
   * status, queue modes, and session identity. The only piece of Pi's RPC surface with no
   * other way to observe the *current* model or thinking level (as opposed to the full list).
   */
  async getState(): Promise<PiSessionState> {
    return this._adapter.getState();
  }

  // --- env & lifecycle ---

  /**
   * Set or update env vars in the running container. Writes to /etc/drej-env and restarts
   * the Pi subprocess so it picks up the new env. Waits until Pi is ready before returning.
   */
  async setEnv(vars: Record<string, string>): Promise<void> {
    this._env = { ...this._env, ...vars };
    await this.sandbox.writeFile("/etc/drej-env", toShellExports(this._env));
    await this._adapter.reloadEnv(this._env);
  }

  /** Retrieve recent bridge logs (ring-buffered, last 200 entries). */
  async getLogs(): Promise<string> {
    return this._adapter.getLogs();
  }

  /** Delete the sandbox container and release all resources. Always call in a `finally` block. */
  async close(): Promise<void> {
    await this.sandbox.close();
  }
}

export type { AgentSnapshotRecord };
