import type { IStorageAdapter, SandboxHooks } from "@drej/core";
import { SandboxStatus } from "@drej/core";

export { SandboxStatus };

/** Thrown when an OpenSandbox API call returns a non-2xx response. */
export class DrejError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DrejError";
  }
}

/** Options for constructing a {@link Drej} client. */
export interface DrejOptions {
  /** Base URL of your OpenSandbox server (e.g. `http://localhost:8080`). */
  baseUrl: string;
  /** OpenSandbox API key. Pass an empty string for local dev with no auth. */
  apiKey?: string;
  /**
   * Storage adapter for persisting sandbox events.
   *
   * Pass `new SQLiteAdapter("./drej.db")` from `@drej/sqlite` for local use, or
   * `new PostgresAdapter(connectionString)` from `@drej/postgres` for production.
   */
  adapter: IStorageAdapter;
  /**
   * Maximum number of sandboxes that may be active simultaneously.
   * When at capacity, `sandbox()` awaits until a slot is free.
   * Omit for no limit.
   */
  maxConcurrency?: number;
  /**
   * Route execd and proxy traffic through the OpenSandbox server instead of
   * connecting to sandbox containers directly. Required when the server runs
   * in Docker (e.g. started via `drejx init`). Defaults to `false`.
   */
  useServerProxy?: boolean;
}

/** Options for `Drej.resume()`. */
export interface ResumeOptions {
  /** Resume from the checkpoint with this tag. Defaults to the most recent checkpoint. */
  tag?: string;
}

/** Options for `Drej.sandbox()`. */
export interface SandboxOptions {
  /**
   * Container image to run. Pass a string (`"node:22"`) or a full `ImageSpec`
   * with optional auth (`{ uri: "ghcr.io/org/image", auth: { username, password } }`).
   */
  image: string | { uri: string; auth?: { username: string; password: string } };
  /** CPU/memory/GPU resource limits. Required by the OpenSandbox server. */
  resources: { cpu: string; memory: string; gpu?: string };
  /** Environment variables set in the container at startup. */
  env?: Record<string, string>;
  /** Arbitrary key-value labels attached to the sandbox (e.g. `{ runId: "ci-42" }`). */
  metadata?: Record<string, string>;
  /**
   * User-provided name for this sandbox run. Used as the ledger key.
   * Defaults to `"sandbox-<shortRunId>"` if omitted.
   */
  name?: string;
  /** Sandbox lifetime in seconds. Defaults to the OpenSandbox server default. */
  timeout?: number;
  /** Observability hooks (e.g. `otelHooks(tracer)` from `@drej/otel`). */
  hooks?: SandboxHooks;
  /**
   * Default shell for all `sb.exec()` calls on this sandbox.
   * Pass an absolute path to the shell binary (e.g. `"/bin/bash"`, `"/bin/zsh"`).
   * Defaults to `"/bin/sh"`.
   */
  shell?: string;
}
