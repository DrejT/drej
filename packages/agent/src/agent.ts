import { Drej } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import type { Sandbox } from "@drej/core";
import { readProjectConfig } from "./config";
import { validateAgentSpec, type AgentSpec } from "./schema";
import { PiAdapter, resolveEnv, toShellExports } from "./adapters/pi";
import type { PromptStream } from "./types";

function elapsed(t: number) {
  return `${Date.now() - t}ms`;
}

export class Agent {
  /** OpenSandbox container ID for this agent's sandbox. */
  readonly sandboxId: string;
  readonly name: string;
  /** Direct access to the underlying Sandbox — full drej Sandbox API, bypasses Pi. */
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
   * Load an agent spec from disk, spin up a sandbox, install the CLI,
   * start the RPC bridge, and return a ready Agent.
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
    const sb = await client.sandbox({ image: "node:22", resources, name: spec.name, env: resolvedEnv });
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

  /** Send a prompt to Pi and stream the response. Pi manages its own session context. */
  prompt(message: string): PromptStream {
    return this._adapter.prompt(message);
  }

  /** Steer Pi's current response mid-flight. Maps to Pi RPC "steer" command. */
  async steer(message: string): Promise<void> {
    return this._adapter.steer(message);
  }

  /** Abort Pi's current operation. Maps to Pi RPC "abort" command. */
  async abort(): Promise<void> {
    return this._adapter.abort();
  }

  /** Start a fresh Pi session, clearing all prior context. Maps to Pi RPC "new_session". */
  async newSession(): Promise<void> {
    return this._adapter.newSession();
  }

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

  async close(): Promise<void> {
    await this.sandbox.close();
  }
}
