import { Drej, SandboxStatus } from "drej";
import { Agent } from "@drej/agent";
import { SQLiteAdapter } from "@drej/sqlite";
import { readConfig } from "../config.js";
import { collectReply } from "../agent-prompt.js";

export async function prompt(
  name: string,
  message: string,
  opts: { json?: boolean } = {},
): Promise<void> {
  if (!name || !message) throw new Error("Usage: drejx prompt <name> <message> [--json]");

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
    throw new Error(
      `No running session named '${name}'. Run 'drejx agents' to see running sessions.`,
    );
  }

  const agent = await Agent.resume(session.sandboxId, {
    adapter,
    specPath: `${config.agentsDir}/${name}.json`,
  });

  const reply = await collectReply(agent, message);

  if (opts.json) {
    console.log(JSON.stringify({ name: agent.name, sandboxId: agent.sandboxId, reply }, null, 2));
    return;
  }
  console.log(reply);
}
