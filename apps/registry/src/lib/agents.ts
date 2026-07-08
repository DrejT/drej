import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface AgentRegistryItem {
  name: string;
  title: string;
  description: string;
  categories: string[];
  path: string;
  spec: Record<string, unknown>;
}

// process.cwd() is the app root (apps/registry) regardless of where Astro
// bundles a caller's chunk during the build — a relative import.meta.url
// path breaks once prerendering moves chunks under dist/.prerender/.
export function getAgentItems(): AgentRegistryItem[] {
  const itemsDir = join(process.cwd(), "public", "agents");

  return readdirSync(itemsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const spec = JSON.parse(readFileSync(join(itemsDir, f), "utf-8"));
      return {
        name: spec.name,
        title: spec.title ?? spec.name,
        description: spec.description ?? "",
        categories: spec.categories ?? [],
        path: `/agents/${f}`,
        spec,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
