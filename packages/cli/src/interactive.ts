import * as readline from "node:readline";
import type { Agent } from "@drej/agent";

/**
 * Foreground REPL over a live `Agent`. Detaching (Ctrl+C, Ctrl+D, or typing
 * "exit"/"quit") only ends this local process — it never calls `agent.close()`,
 * so the sandbox and Pi session keep running and can be reattached later with
 * `drejx attach <name>`.
 */
export async function runInteractive(agent: Agent): Promise<void> {
  console.log(`[drejx] attached to ${agent.name} (${agent.sandboxId})`);
  console.log(
    `[drejx] type a prompt and press enter. Ctrl+C, Ctrl+D, or "exit" to detach (sandbox keeps running).\n`,
  );

  // bun-types' `process.stdin` typing doesn't structurally satisfy node:readline's
  // ReadLineOptions at the type level, though it's a real Node-compatible stream at runtime.
  const rl = readline.createInterface({
    input: process.stdin as unknown as NodeJS.ReadableStream,
    output: process.stdout,
    prompt: "> ",
  });

  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    console.log(`\n[drejx] detached. Reattach with: drejx attach ${agent.name}`);
    rl.close();
    process.exit(0);
  };
  rl.on("SIGINT", detach);

  rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      continue;
    }
    if (trimmed === "exit" || trimmed === "quit") {
      detach();
      return;
    }
    await streamPrompt(agent, trimmed);
    if (detached) return;
    rl.prompt();
  }
  detach();
}

async function streamPrompt(agent: Agent, message: string): Promise<void> {
  for await (const ev of agent.prompt(message)) {
    switch (ev.type) {
      case "text":
        process.stdout.write(ev.text);
        break;
      case "tool_start":
        console.log(`\n[tool] ${ev.toolName} ${JSON.stringify(ev.args).slice(0, 200)}`);
        break;
      case "tool_end":
        console.log(`[tool] ${ev.toolName} ${ev.isError ? "failed" : "done"}`);
        break;
      case "queue_update":
        if (ev.steering.length > 0 || ev.followUp.length > 0) {
          console.log(`\n[queue] steering=${ev.steering.length} followUp=${ev.followUp.length}`);
        }
        break;
      case "compaction_start":
        console.log(`\n[compaction] starting (${ev.reason})...`);
        break;
      case "compaction_end":
        console.log(`[compaction] done`);
        break;
      case "auto_retry_start":
        console.log(
          `\n[retry] attempt ${ev.attempt}/${ev.maxAttempts} in ${ev.delayMs}ms: ${ev.errorMessage}`,
        );
        break;
      case "extension_error":
        console.error(`\n[extension error] ${ev.extensionPath}: ${ev.error}`);
        break;
      default:
        break;
    }
  }
  console.log();
}
