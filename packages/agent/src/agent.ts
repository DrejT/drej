import { Drej } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import type { Sandbox } from "@drej/core";
import { readProjectConfig } from "./config";
import { validateAgentSpec, type AgentSpec } from "./schema";
import { PiAdapter, resolveEnv, toShellExports } from "./adapters/pi";
import type { CompactResult, PiMessage, PiModel, PromptStream, ThinkingLevel } from "./types";

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

  private readonly _adapter: PiAdapter;
  private _env: Record<string, string>;

  private constructor(
    sandbox: Sandbox,
    spec: AgentSpec,
    env: Record<string, string>,
    adapter: PiAdapter,
  ) {
    this.sandbox = sandbox;
    this.sandboxId = sandbox.sandboxId;
    this.name = spec.name;
    this._adapter = adapter;
    this._env = env;
  }

  /**
   * Load an agent spec from disk and return a fully initialised `Agent`.
   *
   * This method:
   * 1. Reads and validates the JSON spec at `specPath`.
   * 2. Reads `drej.config.json` in the current working directory (falls back to
   *    defaults: `http://localhost:8080`, SQLite adapter at `./.drej/ledger.db`,
   *    `useServerProxy: true`).
   * 3. Spawns a `node:22` sandbox container.
   * 4. Installs the Pi CLI and any packages listed in the spec.
   * 5. Starts the RPC bridge inside the container and waits until Pi is ready.
   *
   * Logs timing for each phase to stdout via `[agent]` prefixed lines.
   */
  static async load(specPath: string): Promise<Agent> {
    const t0 = Date.now();
    const spec = validateAgentSpec(await Bun.file(specPath).json());
    const config = await readProjectConfig();
    const resolvedEnv = resolveEnv(spec.env ?? {});

    const client = new Drej({
      baseUrl: config.serverUrl,
      apiKey: config.apiKey,
      adapter: new SQLiteAdapter(config.adapterPath),
      useServerProxy: config.useServerProxy,
    });

    const resources = { ...config.defaults.resources, ...(spec.resources ?? {}) };

    console.log(`[agent] starting sandbox (${spec.name})...`);
    const t1 = Date.now();
    const sb = await client.sandbox({
      image: "node:22",
      resources,
      name: spec.name,
      env: resolvedEnv,
    });
    console.log(`[agent] sandbox ready   ${elapsed(t1)} (${sb.sandboxId})`);

    const adapter = new PiAdapter();

    console.log(`[agent] installing Pi CLI...`);
    const t2 = Date.now();
    await adapter.setup(sb, spec, resolvedEnv);
    console.log(`[agent] Pi CLI ready    ${elapsed(t2)}`);

    console.log(`[agent] starting bridge...`);
    const t3 = Date.now();
    await adapter.startBridge(sb);
    await adapter.waitReady();
    console.log(`[agent] bridge ready    ${elapsed(t3)}`);

    console.log(`[agent] total           ${elapsed(t0)}`);

    return new Agent(sb, spec, resolvedEnv, adapter);
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
   * const agent = await Agent.load("./agents/hello-agent.json");
   * console.log(agent.sandboxId); // save this
   * // ... process exits ...
   *
   * // New process:
   * const agent = await Agent.resume(savedSandboxId);
   * for await (const chunk of agent.prompt("What did we discuss earlier?")) {
   *   process.stdout.write(chunk);
   * }
   * await agent.close();
   * ```
   */
  static async resume(sandboxId: string, opts?: { specPath?: string }): Promise<Agent> {
    const t0 = Date.now();
    const config = await readProjectConfig();

    const client = new Drej({
      baseUrl: config.serverUrl,
      apiKey: config.apiKey,
      adapter: new SQLiteAdapter(config.adapterPath),
      useServerProxy: config.useServerProxy,
    });

    // Resolve the agent spec.
    let spec: import("./schema").AgentSpec;
    if (opts?.specPath) {
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

    // Write /etc/drej-pi.json with resume: true so the bridge starts Pi with --continue.
    const piConfig: Record<string, unknown> = { resume: true };
    if (spec.provider) piConfig.provider = spec.provider;
    if (spec.model) piConfig.model = spec.model;
    await sb.writeFile("/etc/drej-pi.json", JSON.stringify(piConfig));
    await sb.writeFile("/etc/drej-env", toShellExports(resolvedEnv));

    // Kill any stale bridge process before starting a fresh one.
    await sb.exec("pkill -f 'node /drej-bridge.js' 2>/dev/null; sleep 0.1; true", {
      strict: false,
    });

    const adapter = new PiAdapter();

    console.log(`[agent] starting bridge...`);
    const t2 = Date.now();
    await adapter.startBridge(sb);
    await adapter.waitReady();
    console.log(`[agent] bridge ready    ${elapsed(t2)}`);
    console.log(`[agent] total           ${elapsed(t0)}`);

    return new Agent(sb, spec, resolvedEnv, adapter);
  }

  // --- streaming ---

  /** Send a prompt to Pi and stream the response. Pi manages its own session context. */
  prompt(message: string, opts?: { streamingBehavior?: "steer" | "followUp" }): PromptStream {
    return this._adapter.prompt(message, opts);
  }

  /** Run a shell command inside Pi's working context and stream stdout. */
  bash(command: string): PromptStream {
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
