/**
 * Integration test for run-bash-script example.
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

const script = `
#!/bin/bash
set -euo pipefail
echo "=== system info ==="
uname -a
echo "=== writing a file and reading it back ==="
echo "hello from drej" > /tmp/drej-test.txt
cat /tmp/drej-test.txt
echo "=== done ==="
`.trim();

const run = await client.run(
  workflow("bash-script-test").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => { s.exec(script); },
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

assert("stdout contains system info header",  stdout.includes("=== system info ==="), stdout);
assert("stdout contains 'hello from drej'",   stdout.includes("hello from drej"),     stdout);
assert("stdout contains '=== done ==='",      stdout.includes("=== done ==="),        stdout);
assert("run completed",                       run.status === "completed",             run.status);

console.log(failed ? "\nsome assertions failed" : "\n✓ all assertions passed");
await client.close();
if (failed) process.exit(1);
