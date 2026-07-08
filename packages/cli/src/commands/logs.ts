import { Drej } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { readConfig } from "../config.js";

export async function logs(name: string, opts: { json?: boolean } = {}): Promise<void> {
  if (!name) throw new Error("Usage: drejx logs <name> [--json]");

  const config = await readConfig();
  const adapter = new SQLiteAdapter(config.adapterPath);
  const client = new Drej({
    baseUrl: config.serverUrl,
    apiKey: config.apiKey,
    adapter,
    useServerProxy: config.useServerProxy,
  });

  // listByName() connects the adapter as a side effect, so the direct
  // adapter.readAll() call below is safe to make on the same instance.
  const sessions = await client.sandboxes.listByName(name);
  const session = sessions[0]; // newest first
  if (!session) {
    throw new Error(`No session named '${name}' found in the ledger.`);
  }

  const entries = await adapter.readAll(name, session.sandboxId);

  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log(`${entries.length} events for '${name}' (${session.sandboxId}):\n`);
  for (const entry of entries) {
    const ts = new Date(entry.ts).toISOString();
    const suffix = entry.error ? ` error=${entry.error}` : "";
    console.log(`${ts}  ${entry.event}${suffix}`);
    if (entry.payload !== undefined) {
      const payload = JSON.stringify(entry.payload);
      console.log(`  ${payload.length > 200 ? payload.slice(0, 200) + "..." : payload}`);
    }
  }
}
