/**
 * A single named setup step run inside the sandbox after Pi CLI install,
 * before the snapshot is taken. The step is a bash shell command.
 */
export interface SetupStep {
  /** Human-readable label shown in logs and included in the setup hash. */
  name: string;
  /** Shell command to run (bash). */
  run: string;
  /** If set, the command runs as `cd <cwd> && <run>`. */
  cwd?: string;
}

/**
 * JSON spec for an agent — typically loaded from an `agent.json` file on disk.
 * Pass the path to `Agent.load(specPath)`.
 *
 * Environment variable references in `env` values are interpolated from
 * `process.env` at load time: `"${MY_API_KEY}"` → `process.env.MY_API_KEY`.
 */
export interface AgentSpec {
  $schema?: string;
  /** Unique identifier for this agent. Used as the sandbox session name. */
  name: string;
  /** Human-readable display name. */
  title?: string;
  description?: string;
  author?: string;
  categories?: string[];
  /** CLI to run inside the sandbox. Currently only `"pi"` is supported. */
  cli: "pi";
  /**
   * npm version specifier for the Pi CLI, e.g. `"1.2.3"`, `"^1.2.0"`, or a
   * dist-tag like `"latest"`. Passed directly to
   * `npm install -g @earendil-works/pi-coding-agent@<cliVersion>`. When
   * omitted, `install()` runs the bare package name and npm resolves
   * whatever it considers latest. Included in the setup-hash cache key, so
   * changing it forces a fresh snapshot rebuild.
   */
  cliVersion?: string;
  /**
   * AI provider passed to the CLI via `--provider`. For Pi with a direct Google
   * API key, omit this (Pi defaults to the Google Generative AI endpoint).
   */
  provider?: string;
  /**
   * Model ID passed to the CLI via `--model`.
   * For Pi 0.80.x with a free Google AI Studio key, use `"gemini-flash-latest"`
   * (Pi's alias for gemini-3.5-flash via the direct Google Generative AI API).
   */
  model?: string;
  /**
   * APT packages to install in the sandbox before starting the CLI.
   * Example: `["python3", "git"]`. `nodejs_22` and `nodejs` are silently ignored
   * since the base image is `node:22`.
   */
  packages?: string[];
  /**
   * Environment variables available inside the sandbox.
   * Values may reference host env vars: `{ GEMINI_API_KEY: "${GEMINI_API_KEY}" }`.
   */
  env?: Record<string, string>;
  /**
   * CPU/memory/GPU resource limits for the sandbox container.
   * Falls back to defaults in `drej.config.json` if omitted.
   */
  resources?: { cpu: string; memory: string; gpu?: string };
  /** Not read anywhere in `@drej/agent`; has no effect on the sandbox. */
  metadata?: Record<string, string>;
  /**
   * Not read by `@drej/agent` itself — used by `drejx add`, which fetches
   * and saves each dependency spec first, depth-first.
   */
  registryDependencies?: string[];
  /**
   * Setup steps run inside the sandbox after Pi CLI install, before the snapshot.
   * Baked into the snapshot — any change to a step invalidates the cache automatically.
   * Example: create directories, write seed files, install project dependencies.
   */
  setup?: SetupStep[];
}

export function validateAgentSpec(data: unknown): AgentSpec {
  if (!data || typeof data !== "object") throw new Error("Agent spec must be an object");
  const item = data as Record<string, unknown>;
  if (typeof item.name !== "string" || !item.name)
    throw new Error("Agent spec must have a 'name' string");
  if (item.cli !== "pi")
    throw new Error(`Unsupported CLI: '${String(item.cli ?? "(missing)")}'. Supported values: pi`);
  return item as unknown as AgentSpec;
}
