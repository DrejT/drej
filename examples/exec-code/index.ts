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

const run = await client.run(
  workflow("exec-code").sandbox(
    {
      image: { uri: "opensandbox/code-interpreter" },
      entrypoint: ["/opt/code-interpreter/code-interpreter.sh"],
      resourceLimits: { cpu: "500m", memory: "512Mi" },
    },
    (s) =>
      s
        .execCode(`
import sys, math
print(f"[stateless] Python {sys.version.split()[0]}")
print(f"[stateless] pi = {math.pi:.6f}")
        `.trim())
        .execCode(`
data = [2**i for i in range(8)]
print(f"[stateful 1] data = {data}")
        `.trim(), { context: { id: "session", language: "python" } })
        .execCode(`
total = sum(data)
print(f"[stateful 2] sum = {total}")
print(f"[stateful 2] max = {max(data)}")
        `.trim(), { context: { id: "session", language: "python" } }),
  ),
);

console.log(`Run ID: ${run.id}\n`);
await run.pipe(process.stdout);

await client.close();
