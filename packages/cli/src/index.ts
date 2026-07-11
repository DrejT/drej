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
    case "spawn": {
      const { spawn } = await import("./commands/spawn.js");
      const spec = argv.find((a) => !a.startsWith("--")) ?? "";
      const depthFlag = flag("--depth");
      const maxFlag = flag("--max");
      await spawn(spec, {
        prompt: flag("--prompt"),
        rebuild: argv.includes("--rebuild"),
        json: argv.includes("--json"),
        depth: depthFlag !== undefined ? Number(depthFlag) : undefined,
        max: maxFlag !== undefined ? Number(maxFlag) : undefined,
      });
      break;
    }
    case "prompt": {
      const { prompt } = await import("./commands/prompt.js");
      const sandboxId = argv[0] ?? "";
      const message = argv.slice(1).find((a) => !a.startsWith("--")) ?? "";
      await prompt(sandboxId, message, { json: argv.includes("--json"), specPath: flag("--spec") });
      break;
    }
    case "fork": {
      const { fork } = await import("./commands/fork.js");
      const name = argv[0] ?? "";
      const childSpec = argv.slice(1).find((a) => !a.startsWith("--")) ?? "";
      const depthFlag = flag("--depth");
      const maxFlag = flag("--max");
      await fork(name, childSpec, {
        prompt: flag("--prompt"),
        depth: depthFlag !== undefined ? Number(depthFlag) : undefined,
        max: maxFlag !== undefined ? Number(maxFlag) : undefined,
        json: argv.includes("--json"),
      });
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
  drejx spawn <spec>                     Start a fresh agent sandbox, print its name, exit
  drejx spawn <spec> --prompt <msg>      Start it, send one prompt, print the reply, exit
  drejx prompt <sandbox-id> <msg>        Send one prompt to a running sandbox, print the reply
  drejx fork <name> <child-spec>         Fork a running session's own live sandbox into a new child
  drejx agents [--json]                  List running agent sessions
  drejx kill <sandbox-id>                Stop a sandbox
  drejx logs <name> [--json]             Print ledger events for a session

  Add --json to spawn/prompt/fork/agents/logs for machine-readable output.
  Add --depth <n> to spawn/fork to override the spec's "spawnDepth" — the
  nesting-depth budget for further forks.
  Add --max <n> to spawn/fork to override the spec's "maxAgents" — a separate,
  optional ceiling on total descendants for this lineage (not coordinated
  across sibling branches spawned in parallel).
  Add --spec <path> to prompt to skip the ledger lookup for the spec file
  (needed when the sandbox's own creation event lives in a different ledger,
  e.g. a child spawned via 'drejx fork' from inside another sandbox).
`);
      if (cmd) process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
