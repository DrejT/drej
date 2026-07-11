import { Drej } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { readConfig } from "../config.js";
import type { CliCommand } from "./types.js";

/**
 * Addressed by sandbox ID, not session name — see prompt.ts for why: names
 * aren't unique and a name-based ledger lookup can hand back a sandbox that
 * already died ungracefully. `client.connect()`'s live control-plane check
 * is the actual authority on whether it still exists to kill.
 */
export async function kill(sandboxId: string): Promise<void> {
  if (!sandboxId) throw new Error("Usage: drejx kill <sandbox-id>");

  const config = await readConfig();
  const adapter = new SQLiteAdapter(config.adapterPath);
  const client = new Drej({
    baseUrl: config.serverUrl,
    apiKey: config.apiKey,
    adapter,
    useServerProxy: config.useServerProxy,
  });

  const sb = await client.connect(sandboxId, sandboxId);
  await sb.close();
  console.log(`Killed sandbox ${sandboxId}`);
}

export const killCommand: CliCommand = {
  name: "kill",
  group: "agent",
  variants: [{ usage: "drejx kill <sandbox-id>", summary: "Stop a sandbox" }],
  run: async (argv) => {
    await kill(argv[0] ?? "");
  },
};
