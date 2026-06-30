/**
 * Demonstrates the @drej/agent API:
 *
 *   sandbox.writeFile  — host drops files into the container
 *   sandbox.readFile   — host reads files back (including ones Pi created)
 *   sandbox.exec       — host runs shell commands directly, bypassing Pi
 *   agent.prompt()     — send a prompt; Pi can read/write files and run code
 *   agent.newSession() — reset Pi's conversation context
 *
 * Run:  cd examples/agent && bun index.ts
 * Needs: OpenSandbox running (drejx init) and GEMINI_API_KEY in env
 */
import { Agent } from "@drej/agent";

process.env.GEMINI_API_KEY = "AIzaSyBNyRoeeX_gsuL1Dqj9ElcjBGtw1cAdKhc";

const agent = await Agent.load("./agents/hello-agent.json");
console.log(`\nSandbox: ${agent.sandboxId}\n${"─".repeat(60)}\n`);

// node:22 doesn't include /workspace — create it before Pi needs it.
await agent.sandbox.exec("mkdir -p /workspace");

try {
  // ── 1. Host writes a CSV file into the sandbox ──────────────────────────────
  // Pi can read any file in the container via its built-in file-reading tools,
  // so dropping a file here makes it available as context for the agent.
  const csvData = [
    "date,temperature_c",
    "2024-01-15,22.3",
    "2024-01-16,19.8",
    "2024-01-17,25.1",
    "2024-01-18,18.4",
    "2024-01-19,23.7",
    "2024-01-20,21.0",
    "2024-01-21,26.5",
  ].join("\n");

  await agent.sandbox.writeFile("/workspace/sensor_data.csv", csvData + "\n");
  console.log("Host wrote /workspace/sensor_data.csv\n");

  // ── 2. Pi reads the file and reports summary statistics ─────────────────────
  // Pi will use its bash/read tools to inspect the CSV.
  // The host sees Pi's text response; tool calls happen transparently inside Pi.
  console.log("── Pi: summarize sensor data ────────────────────────────────\n");
  for await (const chunk of agent.prompt(
    "Read /workspace/sensor_data.csv and tell me the min, max, and average " +
      "temperature_c. Show the values in your reply.",
  )) {
    process.stdout.write(chunk);
  }
  console.log("\n");

  // ── 3. Pi writes and runs a Python analysis script ───────────────────────────
  // Pi creates the file autonomously using its write_file tool, then runs it.
  console.log("── Pi: write and run analyze.py ─────────────────────────────\n");
  for await (const chunk of agent.prompt(
    "Now write a Python script at /workspace/analyze.py that reads " +
      "/workspace/sensor_data.csv and prints the min, max, and average temperature. " +
      "Run it with python3 and show the output.",
  )) {
    process.stdout.write(chunk);
  }
  console.log("\n");

  // ── 4. Host reads the script Pi created ─────────────────────────────────────
  // agent.sandbox.readFile gives the host direct access to any file Pi wrote.
  // We also list /workspace first so we can find the file if Pi used a different name.
  const { stdout: listing } = await agent.sandbox.exec("ls /workspace/");
  console.log(`── /workspace/ contents: ${listing.trim()}`);

  try {
    const script = await agent.sandbox.readFile("/workspace/analyze.py");
    console.log("\n── Host read /workspace/analyze.py ──────────────────────\n");
    console.log(script);

    // ── 5. Host independently verifies by running the script directly ──────────
    // sandbox.exec bypasses Pi entirely — raw shell, immediate result.
    const { stdout: verifyOut, exitCode } = await agent.sandbox.exec(
      "python3 /workspace/analyze.py",
    );
    console.log(`── Host exec python3 analyze.py (exit ${exitCode}) ─────────\n`);
    console.log(verifyOut);
  } catch {
    console.log("(analyze.py not found — Pi may have used a different path)\n");
  }

  // ── 6. Steer Pi mid-task (new: steer now waits for Pi's RPC acknowledgment) ──
  // Kick off a prompt that would produce a long response, then redirect Pi
  // after a short delay. agent.steer() throws if Pi rejects — unlike before
  // where it was fire-and-forget.
  console.log("── Pi: long task (steered mid-flight) ───────────────────────────\n");
  const longStream = agent.prompt(
    "Write a comprehensive overview of every sorting algorithm ever invented, " +
      "covering pseudocode and time complexity for each one.",
  );
  const steerTimer = setTimeout(async () => {
    try {
      await agent.steer("Stop — summarise in 3 bullet points only.");
      console.log("\n[host] steer acknowledged by Pi\n");
    } catch {
      // Pi may have already finished before the steer arrived
    }
  }, 1500);
  for await (const chunk of longStream) {
    process.stdout.write(chunk);
  }
  clearTimeout(steerTimer);
  console.log("\n");

  // ── 8. New session — Pi forgets the conversation; filesystem is unchanged ────
  await agent.newSession();

  await agent.sandbox.writeFile(
    "/workspace/task.md",
    [
      "# Task",
      "",
      "Write a Python script at /workspace/primes.py that:",
      "1. Finds all prime numbers up to 50 using the Sieve of Eratosthenes",
      "2. Prints each prime",
      "3. Saves them comma-separated to /workspace/primes.txt",
      "",
      "Run the script after writing it.",
    ].join("\n"),
  );
  console.log("Host wrote /workspace/task.md\n");

  // ── 9. Pi reads the task file and completes it ───────────────────────────────
  // Pi's session was reset — it has no memory of the CSV or previous work.
  // But the files are still in the container.
  console.log("── Pi: complete task from task.md ───────────────────────────\n");
  for await (const chunk of agent.prompt(
    "Read /workspace/task.md and complete the task described in it.",
  )) {
    process.stdout.write(chunk);
  }
  console.log("\n");

  // ── 10. Host reads the output Pi produced ────────────────────────────────────
  try {
    const primes = await agent.sandbox.readFile("/workspace/primes.txt");
    console.log("── Host read /workspace/primes.txt ──────────────────────────\n");
    console.log(primes.trim());
    console.log();
  } catch {
    console.log("(primes.txt not found — Pi may have used a different path)\n");
  }
} finally {
  await agent.close();
  console.log("\nAgent closed.");
}
