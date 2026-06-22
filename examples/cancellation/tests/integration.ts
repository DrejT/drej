/**
 * Integration test for timeout and cancellation.
 *
 * Run: bun tests/integration.ts
 * Requires: uvx opensandbox-server
 */
import { DrejClient, workflow, StepTimeoutError } from "drej";
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

const image = { uri: "ubuntu:22.04" };
const resourceLimits = { cpu: "500m", memory: "256Mi" };

// ── Pattern A: per-step timeout ───────────────────────────────────────────────

console.log("Pattern A: per-step timeout");

const runA = await client.run(
  workflow("cancellation-timeout-test").sandbox({ image, resourceLimits }, (s) => {
    s.exec("sleep 30", { timeoutMs: 500 });
    s.exec("echo 'should not run'");
  }),
);

let caughtTimeout: StepTimeoutError | undefined;
let stdoutA = "";
try {
  for await (const ev of runA) {
    if (ev.event === "exec_event") {
      const { text } = ev.payload as { text?: string };
      if (text) stdoutA += text;
    }
  }
} catch (e) {
  if (e instanceof StepTimeoutError) caughtTimeout = e;
  else throw e;
}

assert("timeout: StepTimeoutError thrown",          caughtTimeout instanceof StepTimeoutError,      caughtTimeout);
assert("timeout: timeoutMs reported correctly",     caughtTimeout?.timeoutMs === 500,               caughtTimeout?.timeoutMs);
assert("timeout: step after timeout did not run",   !stdoutA.includes("should not run"),            stdoutA);
assert("timeout: status is failed",                 runA.status === "failed",                       runA.status);

// ── Pattern B: stepTimeoutMs global default ───────────────────────────────────

console.log("Pattern B: global stepTimeoutMs");

const runB = await client.run(
  workflow("cancellation-global-timeout-test").sandbox({ image, resourceLimits }, (s) => {
    s.exec("sleep 30"); // no per-step timeout — falls back to global
  }),
  { stepTimeoutMs: 500 },
);

let caughtGlobal: StepTimeoutError | undefined;
try {
  for await (const ev of runB) { void ev; }
} catch (e) {
  if (e instanceof StepTimeoutError) caughtGlobal = e;
  else throw e;
}

assert("global timeout: StepTimeoutError thrown",   caughtGlobal instanceof StepTimeoutError,       caughtGlobal);
assert("global timeout: status is failed",          runB.status === "failed",                       runB.status);

// ── Pattern C: run.cancel() ───────────────────────────────────────────────────

console.log("Pattern C: run.cancel()");

const runC = await client.run(
  workflow("cancellation-cancel-test").sandbox({ image, resourceLimits }, (s) => {
    s.exec("echo 'step 1'");
    s.exec("sleep 30");
    s.exec("echo 'step 3'");
  }),
);

let stdoutC = "";
let cancelErrorThrown = false;
try {
  for await (const ev of runC) {
    if (ev.event === "exec_event") {
      const { text } = ev.payload as { text?: string };
      if (text) stdoutC += text;
      runC.cancel();
    }
  }
} catch {
  cancelErrorThrown = true;
}

assert("cancel: no error thrown from for-await",    !cancelErrorThrown,                             cancelErrorThrown);
assert("cancel: status is cancelled",               runC.status === "cancelled",                    runC.status);
assert("cancel: step 3 did not run",                !stdoutC.includes("step 3"),                    stdoutC);

// ── Pattern D: break from for-await ──────────────────────────────────────────

console.log("Pattern D: break from for-await");

const runD = await client.run(
  workflow("cancellation-break-test").sandbox({ image, resourceLimits }, (s) => {
    s.exec("echo 'step 1'");
    s.exec("sleep 30");
  }),
);

let breakErrorThrown = false;
try {
  for await (const ev of runD) {
    if (ev.event === "exec_event") break;
  }
} catch {
  breakErrorThrown = true;
}

assert("break: no error thrown",                    !breakErrorThrown,                              breakErrorThrown);
assert("break: status is cancelled",                runD.status === "cancelled",                    runD.status);

console.log(failed ? "\nsome assertions failed" : "\n✓ all assertions passed");
await client.close();
if (failed) process.exit(1);
