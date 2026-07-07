import { Drej, SandboxStatus, type SandboxDetails } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { ControlClient, SandboxState } from "@drej/opensandbox";
import { readConfig, type DrejxConfig } from "./config.js";

export interface SessionSnapshot {
  tracked: SandboxDetails[];
  /** Sandbox IDs running in OpenSandbox but with no ledger record (e.g. agent-spawned children). */
  untracked: string[];
}

/**
 * Data layer shared by `drejx ps` and the TUI dashboard: drej-tracked running
 * sessions from the ledger, merged with raw OpenSandbox sandboxes the ledger
 * never recorded.
 */
export async function getSessions(config?: DrejxConfig): Promise<SessionSnapshot> {
  const cfg = config ?? (await readConfig());
  const adapter = new SQLiteAdapter(cfg.adapterPath);
  const client = new Drej({
    baseUrl: cfg.serverUrl,
    apiKey: cfg.apiKey,
    adapter,
    useServerProxy: cfg.useServerProxy,
  });

  const tracked = await client.sandboxes.list({ status: SandboxStatus.Running });

  const control = new ControlClient({ baseUrl: cfg.serverUrl, apiKey: cfg.apiKey });
  const trackedIds = new Set(tracked.map((s) => s.sandboxId));
  let untracked: string[] = [];
  try {
    const raw = await control.listSandboxes({ state: SandboxState.Running });
    untracked = raw.map((s) => s.id).filter((id) => !trackedIds.has(id));
  } catch {
    // Control-plane listing is best-effort; ledger data above is always returned.
  }

  return { tracked, untracked };
}

export function formatAge(startedAt: number): string {
  const ms = Date.now() - startedAt;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
