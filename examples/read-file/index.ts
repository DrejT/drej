/**
 * Demonstrates readFile() — reading a file from the sandbox into workflow state.
 *
 * Two patterns shown:
 *   interpolation  — use the file content directly in a later exec() command
 *   caller access  — retrieve the content from workflow state after the run
 */
import { DrejClient, workflow } from "drej";
import { SQLiteAdapter } from "@drejt/sqlite";

const client = new DrejClient({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});

await client.connect();

const run = await client.run(
  workflow("read-file-demo").sandbox(
    { image: { uri: "node:20-slim" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) =>
      s
        // Write a file, then read it back into state as "version"
        .exec("node -e \"require('fs').writeFileSync('/tmp/version.txt', process.version)\"")
        .readFile("/tmp/version.txt", { as: "version" })

        // Interpolate the captured value in a subsequent command
        .exec("echo \"Node version from file: {{version}}\"")

        // Write a JSON report using the captured value
        .writeFile("/tmp/report.json", JSON.stringify({ capturedAt: new Date().toISOString() }))
        .readFile("/tmp/report.json", { as: "report" })
        .exec("echo \"Report: {{report}}\""),
  ),
);

console.log(`Run ID: ${run.id}\n`);

let finalState: Record<string, unknown> | undefined;
for await (const ev of run) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) process.stdout.write(text);
  } else if (ev.event === "step_complete") {
    // workflow state is available on each step_complete — last one has all keys
    finalState = ev.payload as Record<string, unknown>;
  }
}

// Access captured file contents from state after the run
if (finalState) {
  console.log("\n--- captured state ---");
  console.log("version:", finalState.version);
  console.log("report:", finalState.report);
}

await client.close();
