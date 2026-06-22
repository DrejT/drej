/**
 * Demonstrates per-step timeouts and run cancellation.
 *
 * Run: bun index.ts
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

const image = { uri: "ubuntu:22.04" };
const resourceLimits = { cpu: "500m", memory: "256Mi" };

// ── Pattern A: per-step timeout ───────────────────────────────────────────────
// The exec step is given 500 ms. `sleep 30` never finishes in time — the step
// is aborted and StepTimeoutError is thrown from the for-await loop.

console.log("=== Pattern A: per-step timeout ===");

const runA = await client.run(
  workflow("cancellation-timeout").sandbox({ image, resourceLimits }, (s) => {
    s.exec("echo 'starting long task...'");
    s.exec("sleep 30", { timeoutMs: 500 });
    s.exec("echo 'this never runs'");
  }),
);

try {
  for await (const ev of runA) {
    if (ev.event === "exec_event") {
      const { text } = ev.payload as { text?: string };
      if (text) process.stdout.write(text);
    }
  }
} catch (e) {
  if (e instanceof StepTimeoutError) {
    console.log(`\nStep "${e.stepId}" timed out after ${e.timeoutMs}ms`);
  } else {
    throw e;
  }
}
console.log(`Status: ${runA.status}\n`);

// ── Pattern B: run.cancel() ───────────────────────────────────────────────────
// Cancel the run after seeing the first exec event. The loop ends cleanly
// (no error thrown). Rollback runs in the background, deleting the sandbox.

console.log("=== Pattern B: run.cancel() ===");

const runB = await client.run(
  workflow("cancellation-cancel").sandbox({ image, resourceLimits }, (s) => {
    s.exec("echo 'step 1'");
    s.exec("sleep 30");
    s.exec("echo 'step 3 — never reached'");
  }),
);

for await (const ev of runB) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) process.stdout.write(text);
    runB.cancel(); // abort immediately after first output
  }
}
console.log(`\nStatus: ${runB.status}\n`);

// ── Pattern C: break from for-await ──────────────────────────────────────────
// Breaking out of the loop fires the same abort as cancel(). No error is
// thrown — the loop just ends.

console.log("=== Pattern C: break from for-await ===");

const runC = await client.run(
  workflow("cancellation-break").sandbox({ image, resourceLimits }, (s) => {
    s.exec("echo 'step 1'");
    s.exec("sleep 30");
  }),
);

for await (const ev of runC) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) process.stdout.write(text);
    break;
  }
}
console.log(`\nStatus: ${runC.status}\n`);

// ── Pattern D: external AbortSignal ──────────────────────────────────────────
// Pass an AbortController signal to cancel from outside the loop, or use
// AbortSignal.timeout() to set an overall run budget.

console.log("=== Pattern D: AbortSignal.timeout() ===");

const runD = await client.run(
  workflow("cancellation-signal").sandbox({ image, resourceLimits }, (s) => {
    s.exec("echo 'starting...'");
    s.exec("sleep 30");
  }),
  { signal: AbortSignal.timeout(800) },
);

try {
  for await (const ev of runD) {
    if (ev.event === "exec_event") {
      const { text } = ev.payload as { text?: string };
      if (text) process.stdout.write(text);
    }
  }
} catch (e) {
  console.log(`\nRun aborted by signal: ${(e as Error).name}`);
}
console.log(`Status: ${runD.status}`);

await client.close();
