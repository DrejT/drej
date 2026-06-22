/**
 * Integration test for hello-world example.
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

const run = await client.run(
  workflow("hello-world-test").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => { s.exec('echo "hello world"'); },
  ),
);

let stdout = "";
for await (const ev of run) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) stdout += text;
  }
}

let failed = false;
function assert(label: string, ok: boolean, got?: unknown) {
  if (!ok) {
    console.error(`FAIL: ${label}${got !== undefined ? ` — got: ${JSON.stringify(got)}` : ""}`);
    failed = true;
  }
}

assert("stdout contains 'hello world'", stdout.includes("hello world"), stdout);
assert("run completed", run.status === "completed", run.status);

console.log(failed ? "\nsome assertions failed" : "\n✓ all assertions passed");
await client.close();
if (failed) process.exit(1);
