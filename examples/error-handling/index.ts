/**
 * Demonstrates error handling patterns:
 *   Pattern A — non-strict exec: non-zero exit puts exitCode in state, use when() to branch
 *   Pattern B — strict exec: non-zero exit throws CommandError
 */
import { Drej, workflow, CommandError, SandboxError, ExecConnectionError } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});
await client.connect();

console.log("=== Pattern A: non-strict exec with when() branching ===");
await client.run(
  workflow("error-handling-a").sandbox(
    { image: { uri: "debian:bookworm-slim" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) =>
      s
        .exec("exit 1")
        .when(
          { op: "eq", field: "exitCode", value: 0 },
          (s) => s.exec("echo success"),
          (s) => s.exec("echo 'command failed, handled gracefully'"),
        ),
  ),
).pipe(process.stdout);

console.log("\n=== Pattern B: strict exec — catch CommandError ===");
try {
  await client.run(
    workflow("error-handling-b").sandbox(
      { image: { uri: "debian:bookworm-slim" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
      (s) =>
        s
          .exec("echo 'about to fail'")
          .exec("exit 42", { strict: true })
          .exec("echo 'this line never runs'"),
    ),
  ).pipe(process.stdout);
} catch (e) {
  if (e instanceof CommandError) {
    console.error(`CommandError: exit code ${e.exitCode} — "${e.command}"`);
  } else if (e instanceof SandboxError) {
    console.error(`SandboxError: ${e.message}`, e.sandboxId ? `(sandbox: ${e.sandboxId})` : "");
  } else if (e instanceof ExecConnectionError) {
    console.error(`ExecConnectionError: execd unreachable for sandbox ${e.sandboxId}`);
  } else {
    throw e;
  }
}

await client.close();
