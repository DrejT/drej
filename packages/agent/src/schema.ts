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
  /** Pin to a specific CLI version (e.g. `"0.80.2"`). Defaults to latest. */
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
  /** Arbitrary labels attached to the sandbox. */
  metadata?: Record<string, string>;
  /** Other agent specs to load as dependencies before this one. */
  registryDependencies?: string[];
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
