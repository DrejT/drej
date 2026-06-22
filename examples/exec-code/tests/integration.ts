/**
 * Integration test for exec-code example.
 * Requires the opensandbox/code-interpreter image.
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
  workflow("exec-code-test").sandbox(
    {
      image: { uri: "opensandbox/code-interpreter" },
      entrypoint: ["/opt/code-interpreter/code-interpreter.sh"],
      resourceLimits: { cpu: "500m", memory: "512Mi" },
    },
    (s) => {
      // stateless: one-shot execution
      s.execCode(`
import sys, math
print(f"[stateless] Python {sys.version.split()[0]}")
print(f"[stateless] pi = {math.pi:.6f}")
      `.trim());

      // stateful: first call defines the variable
      s.execCode(`
data = [2**i for i in range(8)]
print(f"[stateful 1] data = {data}")
      `.trim(), { context: { id: "session", language: "python" } });

      // stateful: second call sees data from the first
      s.execCode(`
total = sum(data)
print(f"[stateful 2] sum = {total}")
print(f"[stateful 2] max = {max(data)}")
      `.trim(), { context: { id: "session", language: "python" } });
    },
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

assert("run completed",                     run.status === "completed",              run.status);
assert("stateless: pi correct",             stdout.includes("pi = 3.141593"),        stdout);
assert("stateful: variable persists",       stdout.includes("[stateful 1] data ="),  stdout);
assert("stateful: sum = 255",               stdout.includes("sum = 255"),            stdout);
assert("stateful: max = 128",               stdout.includes("max = 128"),            stdout);

console.log(failed ? "\nsome assertions failed" : "\n✓ all assertions passed");
await client.close();
if (failed) process.exit(1);
