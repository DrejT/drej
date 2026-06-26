import { readConfig } from "../config.js";
import { readSandboxes, writeSandboxes } from "../sandboxes.js";

export async function remove(name: string): Promise<void> {
  if (!name) throw new Error("Usage: drejx remove <name>");

  const [config, entries] = await Promise.all([readConfig(), readSandboxes()]);
  const idx = entries.findIndex((e) => e.name === name);
  if (idx === -1) throw new Error(`No sandbox named '${name}'. Run 'drejx list' to see available sandboxes.`);

  const entry = entries[idx]!;

  await fetch(`${config.serverUrl}/v1/sandboxes/${entry.sandboxId}`, {
    method: "DELETE",
    headers: config.apiKey ? { "OPEN-SANDBOX-API-KEY": config.apiKey } : {},
  }).catch(() => {});

  entries.splice(idx, 1);
  await writeSandboxes(entries);
  console.log(`Removed sandbox '${name}' (${entry.sandboxId})`);
}
