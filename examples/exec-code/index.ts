/**
 * Demonstrates execCode() for running code in the sandbox interpreter.
 *
 * Two patterns shown:
 *   stateless  — each execCode() call runs in an isolated context
 *   stateful   — calls sharing the same context ID see each other's variables
 */
import { Drej } from "drej";
import { CodeLanguage } from "@drej/opensandbox";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});
await client.connect();

const sb = await client.sandbox({
  image: "opensandbox/code-interpreter",
  env: {},
  name: "exec-code",
});

console.log(`Sandbox ID: ${sb.sandboxId}\n`);

const ctx = { id: "session", language: CodeLanguage.Python };

try {
  // Stateless — isolated context
  await sb.execCode(`
import sys, math
print(f"[stateless] Python {sys.version.split()[0]}")
print(f"[stateless] pi = {math.pi:.6f}")
  `.trim()).pipe(process.stdout);

  // Stateful — variables persist across calls sharing the same context
  await sb.execCode(`
data = [2**i for i in range(8)]
print(f"[stateful 1] data = {data}")
  `.trim(), { context: ctx }).pipe(process.stdout);

  await sb.execCode(`
total = sum(data)
print(f"[stateful 2] sum = {total}")
print(f"[stateful 2] max = {max(data)}")
  `.trim(), { context: ctx }).pipe(process.stdout);
} finally {
  await sb.close();
}

await client.close();
