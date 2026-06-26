#!/usr/bin/env bun
const [, , cmd, ...argv] = process.argv;

async function main(): Promise<void> {
  switch (cmd) {
    case "init": {
      const { init } = await import("./commands/init.js");
      await init();
      break;
    }
    case "add": {
      const { add } = await import("./commands/add.js");
      const url = argv.find((a) => !a.startsWith("--")) ?? "";
      const flag = (name: string) => {
        const i = argv.indexOf(name);
        return i !== -1 ? argv[i + 1] : undefined;
      };
      await add(url, { name: flag("--name"), server: flag("--server") });
      break;
    }
    case "list": {
      const { list } = await import("./commands/list.js");
      await list();
      break;
    }
    case "remove": {
      const { remove } = await import("./commands/remove.js");
      await remove(argv[0] ?? "");
      break;
    }
    default: {
      console.log(`drejx — drej registry CLI

Usage:
  drejx init                           Start OpenSandbox locally via Docker
  drejx add <url> [--name <n>]         Fetch and provision a registry sandbox
  drejx add <url> [--server <url>]     Use a custom OpenSandbox server
  drejx list                           List provisioned sandboxes
  drejx remove <name>                  Remove a sandbox entry
`);
      if (cmd) process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
