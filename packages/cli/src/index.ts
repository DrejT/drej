#!/usr/bin/env bun
const [, , cmd, ...argv] = process.argv;

async function main(): Promise<void> {
  // Bare `drejx` in an interactive terminal launches the TUI; piped/scripted
  // invocations with no subcommand (no TTY) fall through to the help text below.
  if (!cmd && process.stdout.isTTY) {
    const { launchTui } = await import("./tui/index.js");
    await launchTui();
    return;
  }

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
      await add(url, { name: flag("--name") });
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
    case "run": {
      const { run } = await import("./commands/run.js");
      const spec = argv.find((a) => !a.startsWith("--")) ?? "";
      await run(spec, {
        detach: argv.includes("--detach"),
        rebuild: argv.includes("--rebuild"),
      });
      break;
    }
    case "ps": {
      const { ps } = await import("./commands/ps.js");
      await ps();
      break;
    }
    case "attach": {
      const { attach } = await import("./commands/attach.js");
      await attach(argv[0] ?? "");
      break;
    }
    case "kill": {
      const { kill } = await import("./commands/kill.js");
      await kill(argv[0] ?? "");
      break;
    }
    case "logs": {
      const { logs } = await import("./commands/logs.js");
      await logs(argv[0] ?? "");
      break;
    }
    default: {
      console.log(`drejx — drej agent registry CLI

  drejx                              Launch the interactive TUI (in a terminal)

Usage:
  drejx init                        Start OpenSandbox locally via Docker
  drejx add <url> [--name <n>]      Fetch and save an agent spec locally
  drejx list                        List saved agent specs
  drejx remove <name>               Remove a saved agent spec

  drejx run <spec> [--detach]       Run an agent, attaching interactively (tmux-style)
  drejx ps                          List running agent sessions
  drejx attach <name>               Reattach to a running session
  drejx kill <name>                 Stop a running session and delete its sandbox
  drejx logs <name>                 Print ledger events for a session
`);
      if (cmd) process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
