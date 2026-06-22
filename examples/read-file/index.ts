/**
 * Demonstrates readFile() — reading a file from the sandbox into workflow state.
 *
 * Two patterns shown:
 *   interpolation  — use the file content directly in a later exec() command
 *   caller access  — retrieve the content from workflow state after the run
 */
import { Drej, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});

await client.connect();

let versionKey: string, reportKey: string;

const run = await client.run(
  workflow("read-file-demo").sandbox(
    { image: { uri: "node:20-slim" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => {
      // Write a file, then read it back into state
      s.exec("node -e \"require('fs').writeFileSync('/tmp/version.txt', process.version)\"");
      const version = s.readFile("/tmp/version.txt");
      versionKey = version.key;

      // Interpolate the captured value in a subsequent command
      s.exec(`echo "Node version from file: ${version}"`);

      // Write a JSON report and read it back
      s.writeFile("/tmp/report.json", JSON.stringify({ capturedAt: new Date().toISOString() }));
      const report = s.readFile("/tmp/report.json");
      reportKey = report.key;
      s.exec(`echo "Report: ${report}"`);
    },
  ),
);

console.log(`Run ID: ${run.id}\n`);

let finalState: Record<string, unknown> | undefined;
for await (const ev of run) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) process.stdout.write(text);
  } else if (ev.event === "step_complete") {
    finalState = ev.payload as Record<string, unknown>;
  }
}

if (finalState) {
  console.log("\n--- captured state ---");
  console.log("version:", finalState[versionKey!]);
  console.log("report:", finalState[reportKey!]);
}

await client.close();
