import { Drej, SandboxStatus } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { readConfig } from "../config.js";

export async function kill(name: string): Promise<void> {
  if (!name) throw new Error("Usage: drejx kill <name>");

  const config = await readConfig();
  const adapter = new SQLiteAdapter(config.adapterPath);
  const client = new Drej({
    baseUrl: config.serverUrl,
    apiKey: config.apiKey,
    adapter,
    useServerProxy: config.useServerProxy,
  });

  const sessions = await client.sandboxes.list({ status: SandboxStatus.Running });
  const session = sessions.find((s) => s.name === name);
  if (!session) {
    throw new Error(`No running session named '${name}'. Run 'drejx ps' to see running sessions.`);
  }

  const sb = await client.connect(session.sandboxId, name);
  await sb.close();
  console.log(`Killed session '${name}' (${session.sandboxId})`);
}
