/**
 * Demonstrates capturing exec stdout and using it in subsequent steps.
 */
import { Drej } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
  useServerProxy: process.env.USE_SERVER_PROXY !== "false",
});

const sb = await client.sandbox({
  image: "node:20-slim",
  resources: { cpu: "500m", memory: "256Mi" },
  name: "capture-demo",
});

console.log(`Sandbox ID: ${sb.sandboxId}`);

try {
  const { stdout: nodeVersion } = await sb.exec(
    "node -e \"process.stdout.write(process.version)\"",
  );

  await sb.exec(`echo "Running on Node ${nodeVersion.trim()}"`, { strict: false });

  await sb.writeFile(
    "/tmp/info.json",
    JSON.stringify({ node: nodeVersion.trim(), capturedAt: new Date().toISOString() }),
  );

  const infoJson = await sb.readFile("/tmp/info.json");
  await sb.exec(`echo "Captured JSON: ${infoJson}"`).pipe(process.stdout);

  console.log("\n--- captured state ---");
  console.log("nodeVersion:", nodeVersion.trim());
  console.log("info:", infoJson);
} finally {
  await sb.close();
}

