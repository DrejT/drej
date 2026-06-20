/**
 * Demonstrates workflow snapshots and replay.
 *
 * An initial run installs dependencies and captures a snapshot. A replay run
 * boots from that snapshot directly — skipping the install — and runs an
 * updated script against the same environment.
 */
import { DrejClient, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new DrejClient({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});

await client.connect();

const WORKFLOW = "snapshot-replay-demo";
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

// ── Initial run ───────────────────────────────────────────────────────────────
// Installs deps and captures a snapshot after the install step.

const run1 = await client.run(
  workflow(WORKFLOW).sandbox(sandbox, (s) =>
    s
      .exec("pip install -q requests && echo installed")
      .writeFile("/tmp/script.py", script)
      .exec("python3 /tmp/script.py"),
  ),
  { snapshotConfig: { afterSteps: [1] } },
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

// ── Replay ────────────────────────────────────────────────────────────────────
// Boots from the snapshot (deps already present), skips the install step.

const run2 = await client.replayFromSnapshot(
  WORKFLOW,
  run1.id,
  workflow(WORKFLOW).sandbox(
    { resourceLimits: sandbox.resourceLimits },
    (s) => s.writeFile("/tmp/script.py", replayScript).exec("python3 /tmp/script.py"),
  ),
);

console.log(`replay: ${run2.id}`);

for await (const ev of run2) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) process.stdout.write(text);
  }
}

await client.close();
