import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { readConfig } from "../config.js";
import { validateAgentSpec, type AgentSpec } from "../schema.js";

export async function add(url: string, opts: { name?: string } = {}): Promise<void> {
  if (!url) throw new Error("Usage: drejx add <url>");

  const config = await readConfig();
  const spec = await fetchSpec(url);

  for (const depUrl of spec.registryDependencies ?? []) {
    console.log(`Resolving dependency: ${depUrl}`);
    await add(depUrl);
  }

  const name = opts.name ?? spec.name;
  const agentsDir = config.agentsDir;

  if (!existsSync(agentsDir)) await mkdir(agentsDir, { recursive: true });

  const dest = join(agentsDir, `${name}.json`);
  await Bun.write(dest, JSON.stringify(spec, null, 2) + "\n");

  console.log(`Agent spec saved: ${dest}`);
  console.log(`Load it with: Agent.load("${dest}") from @drej/agent`);
}

async function fetchSpec(url: string): Promise<AgentSpec> {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch spec: ${res.status} ${res.statusText}`);
    return validateAgentSpec(await res.json());
  }
  const file = Bun.file(url);
  if (!(await file.exists())) throw new Error(`File not found: ${url}`);
  return validateAgentSpec(await file.json());
}
