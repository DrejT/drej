#!/usr/bin/env bun
// Rewrites `workspace:*` / `workspace:^` / `workspace:~` dependency ranges to
// concrete resolved versions before `npm publish` runs.
//
// `changeset publish` always shells out to plain `npm publish`, which has no
// concept of the `workspace:` protocol (unlike `bun publish` or `pnpm publish`,
// which rewrite it automatically). Left unresolved, every published package
// that depends on a sibling workspace package ships a literal "workspace:*"
// string, which breaks `npm install` for consumers entirely.
//
// Run this once, right before `npm publish`, against the already-versioned
// checkout. It mutates package.json files in place; it is never committed.

import { join } from "node:path";

const root = join(import.meta.dir, "..");
const rootPkg = await Bun.file(join(root, "package.json")).json();

const packageJsonPaths: string[] = [];
for (const pattern of rootPkg.workspaces as string[]) {
  const glob = new Bun.Glob(`${pattern}/package.json`);
  for await (const match of glob.scan({ cwd: root, absolute: true })) {
    packageJsonPaths.push(match);
  }
}

const versionByName = new Map<string, string>();
const packages = await Promise.all(
  packageJsonPaths.map(async (path) => ({ path, json: await Bun.file(path).json() })),
);
for (const { json } of packages) {
  versionByName.set(json.name, json.version);
}

const depFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

let changedCount = 0;
for (const { path, json } of packages) {
  let changed = false;
  for (const field of depFields) {
    const deps = json[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== "string" || !range.startsWith("workspace:")) continue;
      const resolved = versionByName.get(name);
      if (!resolved) {
        throw new Error(
          `Cannot resolve workspace dependency "${name}" (${range}) referenced from ${path}`,
        );
      }
      const specifier = range.slice("workspace:".length);
      deps[name] = specifier === "*" || specifier === "" ? resolved : `${specifier}${resolved}`;
      changed = true;
    }
  }
  if (changed) {
    await Bun.write(path, `${JSON.stringify(json, null, 2)}\n`);
    changedCount++;
    console.log(`resolved workspace: protocol in ${path}`);
  }
}

console.log(`Done. Rewrote ${changedCount} package.json file(s).`);
