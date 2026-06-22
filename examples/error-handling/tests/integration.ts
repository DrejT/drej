/**
 * Integration test for error-handling example.
 * Run: bun tests/integration.ts
 */
import { CommandError, DrejClient, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new DrejClient({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});

await client.connect();

let failed = false;
function assert(label: string, ok: boolean, got?: unknown) {
  if (!ok) {
    console.error(`FAIL: ${label}${got !== undefined ? ` — got: ${JSON.stringify(got)}` : ""}`);
    failed = true;
  }
}

// ── Pattern A: non-strict exec — workflow continues and when() handles failure ─

const runA = await client.run(
  workflow("error-handling-a-test").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => {
      s.exec("exit 1");
      s.when(
        { op: "eq", field: "exitCode", value: 0 },
        (s) => { s.exec("echo success"); },
        (s) => { s.exec("echo 'command failed, handled gracefully'"); },
      );
    },
  ),
);

let stdoutA = "";
for await (const ev of runA) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) stdoutA += text;
  }
}

assert("pattern A: workflow completes",         runA.status === "completed",               runA.status);
assert("pattern A: else-branch fires",          stdoutA.includes("handled gracefully"),    stdoutA);
assert("pattern A: then-branch does not fire",  !stdoutA.includes("success"),              stdoutA);

// ── Pattern B: strict exec — CommandError thrown on non-zero exit ──────────────

const runB = await client.run(
  workflow("error-handling-b-test").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => {
      s.exec("echo 'about to fail'");
      s.exec("exit 42", { strict: true });
      s.exec("echo 'this line never runs'");
    },
  ),
);

let caughtError: CommandError | undefined;
let stdoutB = "";
try {
  for await (const ev of runB) {
    if (ev.event === "exec_event") {
      const { text } = ev.payload as { text?: string };
      if (text) stdoutB += text;
    }
  }
} catch (e) {
  if (e instanceof CommandError) caughtError = e;
  else throw e;
}

assert("pattern B: CommandError is thrown",      caughtError instanceof CommandError,       caughtError);
assert("pattern B: exit code is 42",             caughtError?.exitCode === 42,              caughtError?.exitCode);
assert("pattern B: step after failure skipped",  !stdoutB.includes("this line never runs"), stdoutB);

console.log(failed ? "\nsome assertions failed" : "\n✓ all assertions passed");
await client.close();
if (failed) process.exit(1);
