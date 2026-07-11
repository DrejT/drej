import { Drej, SandboxStatus } from "drej";
import { Agent } from "@drej/agent";
import { SQLiteAdapter } from "@drej/sqlite";
import { readConfig } from "../config.js";
import { collectReply } from "../agent-prompt.js";

/**
 * Fork a running session's own sandbox into a brand-new independent child, per
 * `Agent.spawn()`. Meant to be run BY that session's own Pi bash tool — `name` is
 * the caller's own running session, not the child's. Uses `Agent.attach()`, not
 * `Agent.resume()`, to avoid killing the very bridge process making this call.
 *
 * Resolves the caller's own sandbox ID from `DREJ_SANDBOX_ID` (written to
 * `/etc/drej-env` by every agent-creation path, so it's already in this
 * process's env since it's a descendant of Pi's own bridge process) rather
 * than looking `name` up in the ledger — the calling agent may have been
 * created via an `IStorageAdapter` this CLI invocation has no access to (e.g.
 * a host-side ledger for an `Agent.load()` call this sandbox's own
 * `drej.config.json` knows nothing about), so a ledger-based lookup can't be
 * relied on to find the caller's own session. `name` is only used to label
 * the resulting `Agent` object.
 */
export async function spawn(
  name: string,
  childSpecPath: string,
  opts: { prompt?: string; spawnDepth?: number; json?: boolean } = {},
): Promise<void> {
  if (!name || !childSpecPath)
    throw new Error(
      "Usage: drejx spawn <name> <child-spec> [--prompt <msg>] [--spawn-depth N] [--json]",
    );

  const config = await readConfig();
  const adapter = new SQLiteAdapter(config.adapterPath);

  let selfSandboxId = process.env.DREJ_SANDBOX_ID;
  if (!selfSandboxId) {
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
    selfSandboxId = session.sandboxId;
  }

  const self = await Agent.attach(selfSandboxId, { adapter, name });
  const child = await self.spawn(childSpecPath, { spawnDepth: opts.spawnDepth });

  const reply = opts.prompt ? await collectReply(child, opts.prompt) : undefined;

  if (opts.json) {
    console.log(JSON.stringify({ name: child.name, sandboxId: child.sandboxId, reply }, null, 2));
    return;
  }

  console.log(`\n[drejx] spawned: ${child.name}  sandbox: ${child.sandboxId}`);
  if (reply !== undefined) console.log(`\n${reply}`);
}
