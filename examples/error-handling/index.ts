import { Drej, workflow, CommandError, SandboxError, ExecConnectionError } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPENSANDBOX_URL ?? "http://localhost:8080",
  adapter: new SQLiteAdapter("./drej.db"),
});
await client.connect();

// --- Pattern A: default (non-strict) ---
// Non-zero exit puts exitCode in state; workflow continues.
// Use when() to branch on success vs failure.
console.log("\n=== Pattern A: non-strict exec with when() branching ===");
const runA = await client.run(
  workflow("error-handling-a").sandbox({ image: { uri: "debian:bookworm-slim" } }, (s) =>
    s
      .exec("exit 1")
      .when({ op: "eq", field: "exitCode", value: 0 },
        (s) => s.exec("echo success"),
        (s) => s.exec("echo 'command failed, handled gracefully'"),
      ),
  ),
);
for await (const ev of runA) {
  if (ev.event === "exec_event" && (ev.payload as { type: string; text?: string }).type === "stdout") {
    process.stdout.write((ev.payload as { text: string }).text);
  }
}

// --- Pattern B: strict exec ---
// Non-zero exit throws CommandError with the exit code.
// Catch it outside the for-await loop.
console.log("\n=== Pattern B: strict exec — catch CommandError ===");
const runB = await client.run(
  workflow("error-handling-b").sandbox({ image: { uri: "debian:bookworm-slim" } }, (s) =>
    s
      .exec("echo 'about to fail'")
      .exec("exit 42", { strict: true })
      .exec("echo 'this line never runs'"),
  ),
);
try {
  for await (const ev of runB) {
    if (ev.event === "exec_event" && (ev.payload as { type: string; text?: string }).type === "stdout") {
      process.stdout.write((ev.payload as { text: string }).text);
    }
  }
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
