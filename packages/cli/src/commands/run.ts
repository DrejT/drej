import { Agent } from "@drej/agent";
import { SQLiteAdapter } from "@drej/sqlite";
import { readConfig } from "../config.js";
import { collectReply } from "../agent-prompt.js";

export async function run(
  specPath: string,
  opts: { prompt?: string; rebuild?: boolean; json?: boolean; spawnDepth?: number } = {},
): Promise<void> {
  if (!specPath)
    throw new Error(
      "Usage: drejx run <spec> [--prompt <msg>] [--rebuild] [--spawn-depth N] [--json]",
    );

  const config = await readConfig();
  const adapter = new SQLiteAdapter(config.adapterPath);
  const agent = await Agent.load(specPath, {
    adapter,
    rebuild: opts.rebuild,
    spawnDepth: opts.spawnDepth,
  });

  const reply = opts.prompt ? await collectReply(agent, opts.prompt) : undefined;

  if (opts.json) {
    console.log(JSON.stringify({ name: agent.name, sandboxId: agent.sandboxId, reply }, null, 2));
    return;
  }

  console.log(`\n[drejx] session: ${agent.name}  sandbox: ${agent.sandboxId}`);
  if (reply !== undefined) console.log(`\n${reply}`);
}
