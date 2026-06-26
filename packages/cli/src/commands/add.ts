import { Drej } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { readConfig } from "../config.js";
import { readSandboxes, writeSandboxes } from "../sandboxes.js";
import { validateRegistryItem, type RegistryItem } from "../schema.js";

export async function add(
  url: string,
  opts: { name?: string; server?: string } = {},
): Promise<void> {
  if (!url) throw new Error("Usage: drejx add <url>");

  const config = await readConfig();
  const serverUrl = opts.server ?? config.serverUrl;

  const item = await fetchItem(url);
  const client = new Drej({
    baseUrl: serverUrl,
    apiKey: config.apiKey,
    adapter: new SQLiteAdapter(config.adapterPath),
    useServerProxy: config.useServerProxy,
  });

  for (const depUrl of item.registryDependencies ?? []) {
    console.log(`Resolving dependency: ${depUrl}`);
    await add(depUrl, opts);
  }

  const name = opts.name ?? item.name;
  console.log(`Spawning sandbox '${name}'...`);

  const sb = await client.sandbox({
    image: item.image,
    resources: item.resources,
    env: item.env,
    metadata: { ...item.metadata, registry: item.name },
    name,
  });

  try {
    for (const cmd of item.setup ?? []) {
      console.log(`  $ ${cmd}`);
      await sb.exec(cmd).pipe(process.stdout);
    }
    if ((item.setup ?? []).length > 0) {
      await sb.checkpoint("registry-setup");
    }
  } finally {
    await sb.close();
  }

  const entries = await readSandboxes();
  entries.push({ name, sandboxId: sb.sandboxId, url, createdAt: new Date().toISOString() });
  await writeSandboxes(entries);

  console.log(`Sandbox ready: ${sb.sandboxId}  (${name})`);
  console.log(`Resume it with: client.resume("${sb.sandboxId}")`);
}

async function fetchItem(url: string): Promise<RegistryItem> {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch registry item: ${res.status} ${res.statusText}`);
    return validateRegistryItem(await res.json());
  }
  const file = Bun.file(url);
  if (!(await file.exists())) throw new Error(`File not found: ${url}`);
  return validateRegistryItem(await file.json());
}
