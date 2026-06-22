/**
 * Demonstrates exec() with { capture: true } — storing stdout in workflow state
 * so it can be interpolated into subsequent steps or read back after the run.
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

const { output, state } = await client.run(
  workflow("capture-demo").sandbox(
    { image: { uri: "node:20-slim" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => {
      const nodeVersion = s.exec("node -e \"process.stdout.write(process.version)\"", { capture: true });
      nodeVersionKey = nodeVersion.key;

      s.exec(`echo "Running on Node ${nodeVersion}"`);

      s.exec("echo '{\"node\":\"'\"$NODE_VERSION\"'\"}' > /tmp/info.json", {
        envs: { NODE_VERSION: `${nodeVersion}` },
      });

      const info = s.exec("cat /tmp/info.json", { capture: true });
      infoKey = info.key;
      s.exec(`echo "Captured JSON: ${info}"`);
    },
  ),
).result();

console.log(output);
console.log("--- captured state ---");
console.log("nodeVersion:", state[nodeVersionKey!]);
console.log("info:", state[infoKey!]);

await client.close();
