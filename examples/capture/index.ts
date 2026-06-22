/**
 * Demonstrates exec() with { capture: true } — storing stdout in workflow state
 * so it can be interpolated into subsequent steps.
 */
import { Drej, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});

await client.connect();

let nodeVersionKey: string, infoKey: string;

const run = await client.run(
  workflow("capture-demo").sandbox(
    { image: { uri: "node:20-slim" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => {
      // Capture the Node.js version into state
      const nodeVersion = s.exec("node -e \"process.stdout.write(process.version)\"", { capture: true });
      nodeVersionKey = nodeVersion.key;

      // Interpolate the captured value into the next command
      s.exec(`echo "Running on Node ${nodeVersion}"`);

      // Pass the captured value as an env var
      s.exec("echo '{\"node\":\"'\"$NODE_VERSION\"'\"}' > /tmp/info.json", {
        envs: { NODE_VERSION: `${nodeVersion}` },
      });

      const info = s.exec("cat /tmp/info.json", { capture: true });
      infoKey = info.key;
      s.exec(`echo "Captured JSON: ${info}"`);
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
  console.log("nodeVersion:", finalState[nodeVersionKey!]);
  console.log("info:", finalState[infoKey!]);
}

await client.close();
