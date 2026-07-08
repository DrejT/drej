#!/usr/bin/env bun
const [, , cmd, ...argv] = process.argv;

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

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
        prompt: flag("--prompt"),
        rebuild: argv.includes("--rebuild"),
        json: argv.includes("--json"),
      });
      break;
    }
    case "prompt": {
      const { prompt } = await import("./commands/prompt.js");
      const name = argv[0] ?? "";
      const message = argv.slice(1).find((a) => !a.startsWith("--")) ?? "";
      await prompt(name, message, { json: argv.includes("--json") });
      break;
    }
    case "agents": {
      const { agents } = await import("./commands/agents.js");
      await agents({ json: argv.includes("--json") });
      break;
    }
    case "kill": {
      const { kill } = await import("./commands/kill.js");
      await kill(argv[0] ?? "");
      break;
    }
    case "logs": {
      const { logs } = await import("./commands/logs.js");
      await logs(argv[0] ?? "", { json: argv.includes("--json") });
      break;
    }
    default: {
      console.log(`drejx — drej agent registry CLI

  drejx                              Launch the interactive TUI (in a terminal)

SDK — OpenSandbox config and the local spec cache:
  drejx init                        Start OpenSandbox locally via Docker
  drejx add <url> [--name <n>]      Fetch and save an agent spec locally
  drejx list                        List saved agent specs
  drejx remove <name>               Remove a saved agent spec

Agent — session lifecycle:
  drejx run <spec>                  Start an agent session, print its name, exit
  drejx run <spec> --prompt <msg>   Start it, send one prompt, print the reply, exit
  drejx prompt <name> <msg>         Send one prompt to a running session, print the reply
  drejx agents [--json]             List running agent sessions
  drejx kill <name>                 Stop a session and delete its sandbox
  drejx logs <name> [--json]        Print ledger events for a session

  Add --json to run/prompt/agents/logs for machine-readable output.
`);
      if (cmd) process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
