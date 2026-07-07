import { Agent } from "@drej/agent";
import { SQLiteAdapter } from "@drej/sqlite";
import { readConfig } from "../config.js";
import { runInteractive } from "../interactive.js";

export async function run(
  specPath: string,
  opts: { detach?: boolean; rebuild?: boolean } = {},
): Promise<void> {
  if (!specPath) throw new Error("Usage: drejx run <spec> [--detach] [--rebuild]");

  const config = await readConfig();
  const adapter = new SQLiteAdapter(config.adapterPath);
  const agent = await Agent.load(specPath, { adapter, rebuild: opts.rebuild });

  console.log(`\n[drejx] session: ${agent.name}  sandbox: ${agent.sandboxId}`);

  // Agents invoking `run` through a non-interactive bash tool have no TTY —
  // never drop them into a REPL that reads stdin they can't supply.
  if (opts.detach || !process.stdout.isTTY) {
    console.log(`[drejx] running detached. Attach with: drejx attach ${agent.name}`);
    return;
  }

  await runInteractive(agent);
}
