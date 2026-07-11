import { Agent } from "@drej/agent";
import { SQLiteAdapter } from "@drej/sqlite";
import { readConfig } from "../config.js";
import { collectReply } from "../agent-prompt.js";
import { flag } from "./args.js";
import type { CliCommand } from "./types.js";

/**
 * Addressed by sandbox ID, not session name — names aren't unique (re-running
 * `drejx spawn` on the same spec produces two sandboxes with the same name)
 * and a name-based ledger lookup can hand back a sandbox that died ungracefully
 * (crashed before its `close()` ran, expired via OpenSandbox's own TTL) since
 * nothing ever told the ledger it stopped. `Agent.resume()`'s own `connect()`
 * call is the actual authoritative liveness check — addressing by ID means
 * that's the ONLY check, not a second opinion after an already-stale one.
 *
 * `opts.specPath` lets a caller skip `Agent.resume()`'s own ledger lookup for
 * the spec file entirely — necessary when prompting a sandbox whose
 * `sandbox_created` event lives in a different ledger than this CLI
 * invocation's own (e.g. a child spawned via `drejx fork` from inside
 * another sandbox).
 */
export async function prompt(
  sandboxId: string,
  message: string,
  opts: { json?: boolean; specPath?: string } = {},
): Promise<void> {
  if (!sandboxId || !message)
    throw new Error("Usage: drejx prompt <sandbox-id> <message> [--spec <path>] [--json]");

  const config = await readConfig();
  const adapter = new SQLiteAdapter(config.adapterPath);
  const agent = await Agent.resume(sandboxId, { adapter, specPath: opts.specPath });

  const reply = await collectReply(agent, message);

  if (opts.json) {
    console.log(JSON.stringify({ name: agent.name, sandboxId: agent.sandboxId, reply }, null, 2));
    return;
  }
  console.log(reply);
}

export const promptCommand: CliCommand = {
  name: "prompt",
  group: "agent",
  variants: [
    {
      usage: "drejx prompt <sandbox-id> <msg>",
      summary: "Send one prompt to a running sandbox, print the reply",
    },
  ],
  run: async (argv) => {
    const sandboxId = argv[0] ?? "";
    const message = argv.slice(1).find((a) => !a.startsWith("--")) ?? "";
    await prompt(sandboxId, message, {
      json: argv.includes("--json"),
      specPath: flag(argv, "--spec"),
    });
  },
};
