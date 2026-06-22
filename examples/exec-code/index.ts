/**
 * Demonstrates execCode() for running code directly in the sandbox interpreter.
 *
 * Two patterns shown:
 *   stateless  — each execCode() call runs in an isolated context
 *   stateful   — calls sharing the same context id see each other's variables
 */
import { Drej, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});

await client.connect();

// execCode() requires the code-interpreter image — it bundles Python, Node.js,
// Java, Go, and Bash kernels running via Jupyter inside the sandbox.
const w = workflow("exec-code").sandbox(
  {
    image: { uri: "opensandbox/code-interpreter" },
    entrypoint: ["/opt/code-interpreter/code-interpreter.sh"],
    resourceLimits: { cpu: "500m", memory: "512Mi" },
  },
  (s) =>
    s
      // stateless: one-shot execution, no shared state
      .execCode(`
import sys, math
print(f"[stateless] Python {sys.version.split()[0]}")
print(f"[stateless] pi = {math.pi:.6f}")
      `.trim())

      // stateful: first call defines the variable
      .execCode(`
data = [2**i for i in range(8)]
print(f"[stateful 1] data = {data}")
      `.trim(), { context: { id: "session", language: "python" } })

      // stateful: second call sees `data` from the first call
      .execCode(`
total = sum(data)
print(f"[stateful 2] sum = {total}")
print(f"[stateful 2] max = {max(data)}")
      `.trim(), { context: { id: "session", language: "python" } }),
);

const run = await client.run(w);
console.log(`Run ID: ${run.id} (workflow: ${run.name})\n`);

for await (const ev of run) {
  if (ev.event === "exec_event") {
    const e = ev.payload as { type: string; text?: string };
    if (e.text) process.stdout.write(e.text);
  } else {
    const extra = ev.error ? ` error=${ev.error}` : ev.payload ? ` payload=${JSON.stringify(ev.payload)}` : "";
    console.log(`[${ev.event}] step=${ev.stepIndex}${extra}`);
  }
}

await client.close();
