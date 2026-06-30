import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { join } from "path";
import { readConfig } from "../config.js";

export async function remove(name: string): Promise<void> {
  if (!name) throw new Error("Usage: drejx remove <name>");

  const config = await readConfig();
  const dest = join(config.agentsDir, `${name}.json`);

  if (!existsSync(dest)) {
    throw new Error(`No agent spec named '${name}' in '${config.agentsDir}'. Run 'drejx list' to see available specs.`);
  }

  await unlink(dest);
  console.log(`Removed agent spec '${name}'`);
}
