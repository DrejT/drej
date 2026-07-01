/**
 * Pi agent example — exercises every @drej/agent command:
 *
 *   prompt, bash, steer, followUp, abort, newSession
 *   getMessages, getAvailableModels
 *   setModel, cycleModel, setThinkingLevel, cycleThinkingLevel
 *   setAutoCompaction, compact
 *   clone, fork
 *   setEnv, getLogs
 *   sandbox.exec, sandbox.writeFile, sandbox.readFile
 *
 * Run:  cd examples/pi-agent && bun index.ts
 * Needs: OpenSandbox running (drejx init) and GEMINI_API_KEY in .env
 */
import { Agent, textOnly } from "@drej/agent";

function section(label: string) {
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 58 - label.length))}\n`);
}

const agent = await Agent.load("./agents/hello-agent.json");
console.log(`\nSandbox: ${agent.sandboxId}\n${"─".repeat(60)}`);
await agent.sandbox.exec("mkdir -p /workspace");

try {
  // ── 1. prompt (SSE streaming) ─────────────────────────────────────────────────
  // Provide data inline so Pi answers directly without a tool call.
  section("1. prompt — SSE streaming");
  await agent.sandbox.writeFile(
    "/workspace/data.csv",
    ["date,temp_c", "2024-01-15,22.3", "2024-01-16,19.8", "2024-01-17,25.1"].join("\n") + "\n",
  );
  for await (const chunk of textOnly(agent.prompt(
    "Here is some CSV data:\ndate,temp_c\n2024-01-15,22.3\n2024-01-16,19.8\n2024-01-17,25.1\nTell me the min and max temp_c in one sentence.",
  ))) {
    process.stdout.write(chunk);
  }
  console.log("\n");

  // ── 2. bash ───────────────────────────────────────────────────────────────────
  // Runs a shell command inside Pi's working context and streams stdout.
  section("2. bash — run shell command via Pi");
  for await (const chunk of textOnly(agent.bash("ls -1 /workspace && echo '---' && python3 --version"))) {
    process.stdout.write(chunk);
  }
  console.log("\n");

  // ── 3. getMessages ────────────────────────────────────────────────────────────
  section("3. getMessages — inspect conversation history");
  const messages = await agent.getMessages();
  console.log(`Conversation has ${messages.length} message(s).`);
  const firstUserMsg = messages.find((m) => m.role === "user");
  console.log(`First user message keys: ${Object.keys(firstUserMsg ?? {}).join(", ")}\n`);

  // ── 4. getAvailableModels ─────────────────────────────────────────────────────
  section("4. getAvailableModels — list configured models");
  const models = await agent.getAvailableModels();
  console.log(`${models.length} model(s) available:`);
  for (const m of models) console.log(`  ${m.api}/${m.id}`);
  console.log();

  // ── 5. setModel / cycleModel ──────────────────────────────────────────────────
  // setModel only works with models in Pi's config (not just the full provider list).
  section("5. setModel + cycleModel — switch models at runtime");
  if (models.length > 0) {
    try {
      const set = await agent.setModel(models[0].api as string, models[0].id);
      console.log(`setModel → ${set.api}/${set.id}`);
    } catch (e) {
      console.log(`setModel(${models[0].id}) → not in Pi config: ${(e as Error).message}`);
    }
  }
  const cycled = await agent.cycleModel();
  if (cycled) {
    console.log(
      `cycleModel → ${cycled.model.api}/${cycled.model.id} (thinking: ${cycled.thinkingLevel})`,
    );
  } else {
    console.log("cycleModel → only one model configured, no change");
  }
  console.log();

  // ── 6. setThinkingLevel / cycleThinkingLevel ──────────────────────────────────
  section("6. setThinkingLevel + cycleThinkingLevel");
  try {
    await agent.setThinkingLevel("low");
    console.log("setThinkingLevel(low) → ok");
    const tl = await agent.cycleThinkingLevel();
    console.log(`cycleThinkingLevel → ${tl?.level ?? "model does not support thinking"}`);
  } catch (e) {
    console.log(`thinking not supported by current model: ${(e as Error).message}`);
  }
  console.log();

  // ── 7. setAutoCompaction ─────────────────────────────────────────────────────
  section("7. setAutoCompaction");
  await agent.setAutoCompaction(false);
  console.log("setAutoCompaction(false) → ok");
  await agent.setAutoCompaction(true);
  console.log("setAutoCompaction(true) → ok\n");

  // ── 8. steer mid-flight ───────────────────────────────────────────────────────
  section("8. steer — redirect Pi mid-response");
  const longStream = textOnly(agent.prompt(
    "Write a detailed essay on every sorting algorithm ever invented with pseudocode.",
  ));
  const steerTimer = setTimeout(async () => {
    try {
      await agent.steer("Stop — give me just 3 bullet points instead.");
      console.log("\n[host] steer acknowledged\n");
    } catch {
      // Pi may have already finished
    }
  }, 1500);
  for await (const chunk of longStream) {
    process.stdout.write(chunk);
  }
  clearTimeout(steerTimer);
  console.log("\n");

  // ── 9. followUp ───────────────────────────────────────────────────────────────
  // Queue a message that Pi will process after its current task completes.
  section("9. followUp — queue message for after current task");
  const followStream = textOnly(agent.prompt("Count from 1 to 5, one number per line."));
  await agent.followUp("Now count backwards from 5 to 1, one number per line.");
  for await (const chunk of followStream) {
    process.stdout.write(chunk);
  }
  console.log("\n");
  // The followUp was queued inside Pi — send an empty prompt to drain it.
  section("9b. drain the followUp turn");
  for await (const chunk of textOnly(agent.prompt("(continue)"))) {
    process.stdout.write(chunk);
  }
  console.log("\n");

  // ── 10. clone ─────────────────────────────────────────────────────────────────
  // Clone creates a new Pi session branch at the current position.
  section("10. clone — branch current session");
  const cloned = await agent.clone();
  console.log(`clone → cancelled: ${cloned.cancelled}\n`);

  // ── 11. fork ──────────────────────────────────────────────────────────────────
  // Fork branches from a specific user message entry in the history.
  section("11. fork — branch from a specific history entry");
  const history = await agent.getMessages();
  const forkableMsg = history.find((m) => m.role === "user" && (m.id ?? m.entryId));
  if (forkableMsg) {
    const entryId = (forkableMsg.id ?? forkableMsg.entryId) as string;
    try {
      const forked = await agent.fork(entryId);
      console.log(`fork(${entryId.slice(0, 12)}…) → cancelled: ${forked.cancelled}`);
      console.log(`  forked from: "${String(forked.text).slice(0, 60)}…"`);
    } catch (e) {
      console.log(`fork failed: ${(e as Error).message}`);
    }
  } else {
    console.log("no forkable message found (id field not exposed for this model)");
  }
  console.log();

  // ── 12. compact + newSession + final task ────────────────────────────────────
  section("12. compact — session now has many messages, should succeed");
  try {
    const compacted = await agent.compact();
    console.log(
      `compact → ${compacted.tokensBefore} tokens before, ~${compacted.estimatedTokensAfter} after`,
    );
  } catch (e) {
    console.log(`compact → skipped: ${(e as Error).message}`);
  }
  console.log();

  section("12b. newSession — clear context, filesystem unchanged");
  await agent.newSession();
  console.log("Session reset.\n");

  await agent.sandbox.writeFile("/workspace/hello.py", 'print("hello from Pi sandbox")\n');
  for await (const chunk of textOnly(agent.prompt(
    "Run /workspace/hello.py with python3 and tell me what it prints.",
  ))) {
    process.stdout.write(chunk);
  }
  console.log("\n");

  // ── 13. getLogs ───────────────────────────────────────────────────────────────
  section("13. getLogs — bridge ring-buffer (last 5 entries)");
  const logs = await agent.getLogs();
  const logLines = logs.trim().split("\n");
  console.log(`${logLines.length} log entries total. Last 5:`);
  for (const line of logLines.slice(-5)) console.log(" ", line);
  console.log();
} finally {
  await agent.close();
  console.log("Agent closed.");
}
