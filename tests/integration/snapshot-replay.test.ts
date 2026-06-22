import { Drej, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { beforeAll, afterAll, test, expect, describe } from "bun:test";

let client: Drej;

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

beforeAll(async () => {
  client = new Drej({
    baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
    apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
    adapter: new SQLiteAdapter(":memory:"),
  });
  await client.connect();
});

afterAll(() => client.close());

describe("snapshot replay", () => {
  test("inline s.snapshot(): snapshot fires and replay skips pip install", async () => {
    const WORKFLOW = "snapshot-inline-test";

    const run1 = await client.run(
      workflow(WORKFLOW).sandbox(sandbox, (s) => {
        s.exec("pip install -q requests && echo installed");
        s.snapshot();
        s.writeFile("/tmp/script.py", script);
        s.exec("python3 /tmp/script.py");
      }),
    );

    let snapshotId: string | undefined;
    let stdout1 = "";
    for await (const ev of run1) {
      if (ev.event === "exec_event") {
        const { text } = ev.payload as { text?: string };
        if (text) stdout1 += text;
      } else if (ev.event === "snapshot") {
        snapshotId = (ev.payload as { snapshotId: string }).snapshotId;
      }
    }

    expect(run1.status).toBe("completed");
    expect(snapshotId).toBeDefined();
    expect(stdout1).toContain("installed");

    const replay = await client.replayFromSnapshot(
      WORKFLOW,
      run1.id,
      workflow(WORKFLOW).sandbox(
        { resourceLimits: sandbox.resourceLimits },
        (s) => {
          s.writeFile("/tmp/script.py", replayScript);
          s.exec("python3 /tmp/script.py");
        },
      ),
    );

    let stdoutReplay = "";
    for await (const ev of replay) {
      if (ev.event === "exec_event") {
        const { text } = ev.payload as { text?: string };
        if (text) stdoutReplay += text;
      }
    }

    expect(replay.status).toBe("completed");
    expect(stdoutReplay).toContain("(replay)");
  });

  test("snapshotConfig on client.run(): external snapshot fires and replay works", async () => {
    const WORKFLOW = "snapshot-external-test";

    const run2 = await client.run(
      workflow(WORKFLOW).sandbox(sandbox, (s) => {
        s.exec("pip install -q requests && echo installed");
        s.writeFile("/tmp/script.py", script);
        s.exec("python3 /tmp/script.py");
      }),
      { snapshotConfig: { afterSteps: [1] } },
    );

    let snapshotId: string | undefined;
    for await (const ev of run2) {
      if (ev.event === "snapshot") {
        snapshotId = (ev.payload as { snapshotId: string }).snapshotId;
      }
    }

    expect(run2.status).toBe("completed");
    expect(snapshotId).toBeDefined();

    const replay = await client.replayFromSnapshot(
      WORKFLOW,
      run2.id,
      workflow(WORKFLOW).sandbox(
        { resourceLimits: sandbox.resourceLimits },
        (s) => {
          s.writeFile("/tmp/script.py", replayScript);
          s.exec("python3 /tmp/script.py");
        },
      ),
    );

    let stdoutReplay = "";
    for await (const ev of replay) {
      if (ev.event === "exec_event") {
        const { text } = ev.payload as { text?: string };
        if (text) stdoutReplay += text;
      }
    }

    expect(replay.status).toBe("completed");
    expect(stdoutReplay).toContain("(replay)");
  });
});
