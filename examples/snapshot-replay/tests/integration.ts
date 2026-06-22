/**
 * Integration test for snapshot-replay example.
 * Run: bun tests/integration.ts
 */
import { DrejClient, workflow } from "drej";
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

const sandbox = { image: { uri: "python:3.11-slim" }, resourceLimits: { cpu: "1", memory: "512Mi" } };

const script = `
import sys, requests
r = requests.get("https://httpbin.org/get", timeout=5)
print(f"Python {sys.version.split()[0]}, status {r.status_code}")
`.trim();

const replayScript = `
import sys, requests
r = requests.get("https://httpbin.org/json", timeout=5)
print(f"Python {sys.version.split()[0]} (replay), status {r.status_code}")
`.trim();

// ── Pattern A: inline s.snapshot() ───────────────────────────────────────────

const WORKFLOW_A = "snapshot-inline-test";

const run1 = await client.run(
  workflow(WORKFLOW_A).sandbox(sandbox, (s) => {
    s.exec("pip install -q requests && echo installed");
    s.snapshot();
    s.writeFile("/tmp/script.py", script);
    s.exec("python3 /tmp/script.py");
  }),
);

let snapshotIdA: string | undefined;
let stdoutRun1 = "";
for await (const ev of run1) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) stdoutRun1 += text;
  } else if (ev.event === "snapshot") {
    snapshotIdA = (ev.payload as { snapshotId: string }).snapshotId;
  }
}

assert("pattern A: run1 completes",           run1.status === "completed",   run1.status);
assert("pattern A: snapshot event fired",      !!snapshotIdA,                 snapshotIdA);
assert("pattern A: pip install succeeded",     stdoutRun1.includes("installed"), stdoutRun1);

const replay1 = await client.replayFromSnapshot(
  WORKFLOW_A,
  run1.id,
  workflow(WORKFLOW_A).sandbox(
    { resourceLimits: sandbox.resourceLimits },
    (s) => {
      s.writeFile("/tmp/script.py", replayScript);
      s.exec("python3 /tmp/script.py");
    },
  ),
);

let stdoutReplay1 = "";
for await (const ev of replay1) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) stdoutReplay1 += text;
  }
}

assert("pattern A: replay completes",         replay1.status === "completed",         replay1.status);
assert("pattern A: replay output contains (replay)", stdoutReplay1.includes("(replay)"), stdoutReplay1);

// ── Pattern B: snapshotConfig on client.run() ─────────────────────────────────

const WORKFLOW_B = "snapshot-external-test";

const run2 = await client.run(
  workflow(WORKFLOW_B).sandbox(sandbox, (s) => {
    s.exec("pip install -q requests && echo installed");
    s.writeFile("/tmp/script.py", script);
    s.exec("python3 /tmp/script.py");
  }),
  { snapshotConfig: { afterSteps: [1] } },
);

let snapshotIdB: string | undefined;
let stdoutRun2 = "";
for await (const ev of run2) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) stdoutRun2 += text;
  } else if (ev.event === "snapshot") {
    snapshotIdB = (ev.payload as { snapshotId: string }).snapshotId;
  }
}

assert("pattern B: run2 completes",           run2.status === "completed",   run2.status);
assert("pattern B: snapshot event fired",      !!snapshotIdB,                 snapshotIdB);

const replay2 = await client.replayFromSnapshot(
  WORKFLOW_B,
  run2.id,
  workflow(WORKFLOW_B).sandbox(
    { resourceLimits: sandbox.resourceLimits },
    (s) => {
      s.writeFile("/tmp/script.py", replayScript);
      s.exec("python3 /tmp/script.py");
    },
  ),
);

let stdoutReplay2 = "";
for await (const ev of replay2) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) stdoutReplay2 += text;
  }
}

assert("pattern B: replay completes",          replay2.status === "completed",         replay2.status);
assert("pattern B: replay output contains (replay)", stdoutReplay2.includes("(replay)"), stdoutReplay2);

console.log(failed ? "\nsome assertions failed" : "\n✓ all assertions passed");
await client.close();
if (failed) process.exit(1);
