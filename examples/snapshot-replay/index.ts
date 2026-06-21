/**
 * Demonstrates two ways to capture sandbox snapshots and replay from them.
 *
 * Pattern A — s.snapshot() inline step (preferred):
 *   Declare the checkpoint directly in the workflow definition. Position-aware,
 *   no step indices to count.
 *
 * Pattern B — snapshotConfig on client.run() (external):
 *   Snapshot a workflow you didn't write, or snapshot on a cadence
 *   (everyNSteps) rather than at a fixed point.
 */
import { DrejClient, workflow } from "drej";
import { SQLiteAdapter } from "@drejt/sqlite";

const client = new DrejClient({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});

await client.connect();

const sandbox = { image: { uri: "python:3.11-slim" }, resourceLimits: { cpu: "1", memory: "512Mi" } };

const script = `
import sys, requests
r = requests.get("https://httpbin.org/get", timeout=5)
print(f"Python {sys.version.split()[0]}, status {r.status_code}")
`.trim();

const replayScript = `
import sys, json, requests
r = requests.get("https://httpbin.org/json", timeout=5)
print(f"Python {sys.version.split()[0]} (replay)")
print(json.dumps(r.json(), indent=2))
`.trim();

// ── Pattern A: s.snapshot() inline ───────────────────────────────────────────
// The checkpoint is declared where it belongs — in the workflow itself.

console.log("=== Pattern A: inline s.snapshot() ===\n");

const WORKFLOW_A = "snapshot-inline";

const run1 = await client.run(
  workflow(WORKFLOW_A).sandbox(sandbox, (s) =>
    s
      .exec("pip install -q requests && echo installed")
      .snapshot()                           // checkpoint declared inline
      .writeFile("/tmp/script.py", script)
      .exec("python3 /tmp/script.py"),
  ),
);

console.log(`run: ${run1.id}`);
for await (const ev of run1) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) process.stdout.write(text);
  } else if (ev.event === "snapshot") {
    const { snapshotId } = ev.payload as { snapshotId: string };
    console.log(`snapshot: ${snapshotId}`);
  }
}

const replay1 = await client.replayFromSnapshot(
  WORKFLOW_A,
  run1.id,
  workflow(WORKFLOW_A).sandbox(
    { resourceLimits: sandbox.resourceLimits },
    (s) => s.writeFile("/tmp/script.py", replayScript).exec("python3 /tmp/script.py"),
  ),
);

console.log(`\nreplay: ${replay1.id}`);
for await (const ev of replay1) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) process.stdout.write(text);
  }
}

// ── Pattern B: snapshotConfig on client.run() ─────────────────────────────────
// Useful when you can't or don't want to modify the workflow definition —
// e.g. snapshotting a shared workflow, or snapshotting every N steps.

console.log("\n=== Pattern B: snapshotConfig on client.run() ===\n");

const WORKFLOW_B = "snapshot-external";

const externalWorkflow = workflow(WORKFLOW_B).sandbox(sandbox, (s) =>
  s
    .exec("pip install -q requests && echo installed")
    .writeFile("/tmp/script.py", script)
    .exec("python3 /tmp/script.py"),
);

// afterSteps index 1 corresponds to the exec after create_sandbox (index 0).
// This is more fragile than s.snapshot() — reordering steps silently shifts indices.
const run2 = await client.run(externalWorkflow, {
  snapshotConfig: { afterSteps: [1] },
});

console.log(`run: ${run2.id}`);
for await (const ev of run2) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) process.stdout.write(text);
  } else if (ev.event === "snapshot") {
    const { snapshotId } = ev.payload as { snapshotId: string };
    console.log(`snapshot: ${snapshotId}`);
  }
}

const replay2 = await client.replayFromSnapshot(
  WORKFLOW_B,
  run2.id,
  workflow(WORKFLOW_B).sandbox(
    { resourceLimits: sandbox.resourceLimits },
    (s) => s.writeFile("/tmp/script.py", replayScript).exec("python3 /tmp/script.py"),
  ),
);

console.log(`\nreplay: ${replay2.id}`);
for await (const ev of replay2) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) process.stdout.write(text);
  }
}

await client.close();
