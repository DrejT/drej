import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

const CONTENT_ROOT = join(import.meta.dir, "../content/docs");
const OUT = join(import.meta.dir, "../public/_redirects");

function firstPage(dir: string): string | null {
  const metaPath = join(dir, "meta.json");
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    if (Array.isArray(meta.pages) && meta.pages.length > 0) {
      return meta.pages[0];
    }
  }
  // Fallback: alphabetical first .mdx
  const mdx = readdirSync(dir)
    .filter((f) => f.endsWith(".mdx"))
    .sort()[0];
  return mdx ? mdx.replace(/\.mdx$/, "") : null;
}

function walk(dir: string): string[] {
  const redirects: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;

    const hasMdx = readdirSync(full).some((f) => f.endsWith(".mdx"));
    const hasIndex = existsSync(join(full, "index.mdx"));

    if (hasMdx && !hasIndex) {
      const first = firstPage(full);
      if (first) {
        const from = "/docs/" + relative(CONTENT_ROOT, full);
        const to = from + "/" + first;
        redirects.push(`${from} ${to} 301`);
      }
    }

    redirects.push(...walk(full));
  }

  return redirects;
}

const lines = walk(CONTENT_ROOT);
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`Generated ${lines.length} redirect(s) → public/_redirects`);
