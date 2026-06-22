/**
 * Demonstrates two ways to capture sandbox snapshots and replay from them.
 *
 * Pattern A — s.snapshot() inline step (preferred):
 *   Declare the checkpoint directly in the workflow definition.
 *
 * Pattern B — snapshotConfig on client.run() (external):
 *   Snapshot a workflow you didn't write, or snapshot on a cadence.
 */
import { Drej, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
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

console.log("=== Pattern A: inline s.snapshot() ===\n");

const WORKFLOW_A = "snapshot-inline";

const run1 = await client.run(
  workflow(WORKFLOW_A).sandbox(sandbox, (s) =>
    s
      .exec("pip install -q requests && echo installed")
      .snapshot()
      .writeFile("/tmp/script.py", script)
      .exec("python3 /tmp/script.py"),
  ),
);

console.log(`run: ${run1.id}`);
for await (const ev of run1) {
  if (ev.event === "exec_event") {
    const { type, text } = ev.payload as { type?: string; text?: string };
    if (type === "stdout" && text) process.stdout.write(text);
  } else if (ev.event === "snapshot") {
    console.log(`snapshot: ${(ev.payload as { snapshotId: string }).snapshotId}`);
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
await replay1.pipe(process.stdout);

// ── Pattern B: snapshotConfig on client.run() ─────────────────────────────────

console.log("\n=== Pattern B: snapshotConfig on client.run() ===\n");

const WORKFLOW_B = "snapshot-external";

const run2 = await client.run(
  workflow(WORKFLOW_B).sandbox(sandbox, (s) =>
    s
      .exec("pip install -q requests && echo installed")
      .writeFile("/tmp/script.py", script)
      .exec("python3 /tmp/script.py"),
  ),
  { snapshotConfig: { afterSteps: [1] } },
);

console.log(`run: ${run2.id}`);
for await (const ev of run2) {
  if (ev.event === "exec_event") {
    const { type, text } = ev.payload as { type?: string; text?: string };
    if (type === "stdout" && text) process.stdout.write(text);
  } else if (ev.event === "snapshot") {
    console.log(`snapshot: ${(ev.payload as { snapshotId: string }).snapshotId}`);
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
await replay2.pipe(process.stdout);

await client.close();
