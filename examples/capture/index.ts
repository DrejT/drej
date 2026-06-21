/**
 * Demonstrates exec() with { capture } — storing stdout in workflow state
 * so it can be interpolated into subsequent steps.
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
  workflow("capture-demo").sandbox(
    { image: { uri: "node:20-slim" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) =>
      s
        // Capture the git SHA into state as "sha"
        .exec("node -e \"process.stdout.write(process.version)\"", { capture: "nodeVersion" })

        // Interpolate the captured value into the next command
        .exec("echo \"Running on Node {{nodeVersion}}\"")

        // Capture can also feed into writeFile content via a workaround:
        // write a dynamic file using the captured value
        .exec("echo '{\"node\":\"'\"$NODE_VERSION\"'\"}' > /tmp/info.json", {
          envs: { NODE_VERSION: "{{nodeVersion}}" },
        })
        .exec("cat /tmp/info.json", { capture: "info" })
        .exec("echo \"Captured JSON: {{info}}\""),
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
  console.log("nodeVersion:", finalState.nodeVersion);
  console.log("info:", finalState.info);
}

await client.close();
