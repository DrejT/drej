import { Drej, SandboxStatus } from "drej";
import { Agent } from "@drej/agent";
import { SQLiteAdapter } from "@drej/sqlite";
import { readConfig } from "../config.js";
import { runInteractive } from "../interactive.js";

export async function attach(name: string): Promise<void> {
  if (!name) throw new Error("Usage: drejx attach <name>");

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

  if (!process.stdout.isTTY) {
    console.log(
      `[drejx] session '${name}' is running (${session.sandboxId}) — not attaching (no TTY).`,
    );
    return;
  }

  const agent = await Agent.resume(session.sandboxId, {
    adapter,
    specPath: `${config.agentsDir}/${name}.json`,
  });

  await runInteractive(agent);
}
