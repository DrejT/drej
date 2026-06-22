/**
 * Demonstrates per-step timeouts and run cancellation.
 *
 * Pattern A — per-step timeoutMs → StepTimeoutError
 * Pattern B — run.cancel() after first output
 * Pattern C — break from for-await loop
 * Pattern D — external AbortSignal.timeout()
 */
import { Drej, workflow, StepTimeoutError } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});
await client.connect();

const image = { uri: "ubuntu:22.04" };
const resourceLimits = { cpu: "500m", memory: "256Mi" };

// ── Pattern A: per-step timeout ───────────────────────────────────────────────

console.log("=== Pattern A: per-step timeout ===");

const runA = await client.run(
  workflow("cancellation-timeout").sandbox({ image, resourceLimits }, (s) => {
    s.exec("echo 'starting long task...'");
    s.exec("sleep 30", { timeoutMs: 500 });
    s.exec("echo 'this never runs'");
  }),
);

try {
  await runA.pipe(process.stdout);
} catch (e) {
  if (e instanceof StepTimeoutError) {
    console.log(`\nStep timed out after ${e.timeoutMs}ms`);
  } else throw e;
}
console.log(`Status: ${runA.status}\n`);

// ── Pattern B: run.cancel() ───────────────────────────────────────────────────

console.log("=== Pattern B: run.cancel() ===");

const runB = await client.run(
  workflow("cancellation-cancel").sandbox({ image, resourceLimits }, (s) => {
    s.exec("echo 'step 1'");
    s.exec("sleep 30");
    s.exec("echo 'step 3 — never reached'");
  }),
);

for await (const text of runB.stdout()) {
  process.stdout.write(text);
  runB.cancel();
}
console.log(`\nStatus: ${runB.status}\n`);

// ── Pattern C: break from for-await ──────────────────────────────────────────

console.log("=== Pattern C: break from for-await ===");

const runC = await client.run(
  workflow("cancellation-break").sandbox({ image, resourceLimits }, (s) => {
    s.exec("echo 'step 1'");
    s.exec("sleep 30");
  }),
);

for await (const text of runC.stdout()) {
  process.stdout.write(text);
  break;
}
console.log(`\nStatus: ${runC.status}\n`);

// ── Pattern D: external AbortSignal ──────────────────────────────────────────

console.log("=== Pattern D: AbortSignal.timeout() ===");

const runD = await client.run(
  workflow("cancellation-signal").sandbox({ image, resourceLimits }, (s) => {
    s.exec("echo 'starting...'");
    s.exec("sleep 30");
  }),
  { signal: AbortSignal.timeout(800) },
);

try {
  await runD.pipe(process.stdout);
} catch (e) {
  console.log(`\nRun aborted by signal: ${(e as Error).name}`);
}
console.log(`Status: ${runD.status}`);

await client.close();
