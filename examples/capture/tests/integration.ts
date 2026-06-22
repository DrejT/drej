/**
 * Integration test for capture example.
 * Run: bun tests/integration.ts
 */
import { DrejClient, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new DrejClient({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});

await client.connect();

let nodeVersionKey: string, infoKey: string;

const run = await client.run(
  workflow("capture-test").sandbox(
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
    },
  ),
);

let finalState: Record<string, unknown> | undefined;
let stdout = "";
for await (const ev of run) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) stdout += text;
  } else if (ev.event === "step_complete") {
    finalState = ev.payload as Record<string, unknown>;
  }
}

let failed = false;
function assert(label: string, ok: boolean, got?: unknown) {
  if (!ok) {
    console.error(`FAIL: ${label}${got !== undefined ? ` — got: ${JSON.stringify(got)}` : ""}`);
    failed = true;
  }
}

const nodeVersion = finalState?.[nodeVersionKey!] as string | undefined;
const info        = finalState?.[infoKey!] as string | undefined;

assert("nodeVersion captured",            !!nodeVersion,                     nodeVersion);
assert("nodeVersion starts with 'v'",     nodeVersion?.startsWith("v") ?? false, nodeVersion);
assert("stdout contains node version",    stdout.includes("Running on Node"), stdout);
assert("info JSON captured",              !!info,                            info);
assert("info contains 'node' key",        info?.includes('"node"') ?? false, info);
assert("run completed",                   run.status === "completed",        run.status);

console.log(failed ? "\nsome assertions failed" : "\n✓ all assertions passed");
await client.close();
if (failed) process.exit(1);
