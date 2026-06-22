import { DrejClient, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { beforeAll, afterAll, test, expect } from "bun:test";

let client: DrejClient;

beforeAll(async () => {
  client = new DrejClient({
    baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
    apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
    adapter: new SQLiteAdapter(":memory:"),
  });
  await client.connect();
});

afterAll(() => client.close());

test("readFile captures file contents into finalState", async () => {
  let versionKey: string;
  let reportKey: string;

  const run = await client.run(
    workflow("read-file-test").sandbox(
      { image: { uri: "node:20-slim" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
      (s) => {
        s.exec("node -e \"require('fs').writeFileSync('/tmp/version.txt', process.version)\"");
        const version = s.readFile("/tmp/version.txt");
        versionKey = version.key;
        s.exec(`echo "Node version from file: ${version}"`);

        s.writeFile("/tmp/report.json", JSON.stringify({ capturedAt: new Date().toISOString() }));
        const report = s.readFile("/tmp/report.json");
        reportKey = report.key;
      },
    ),
  );

  let finalState: Record<string, unknown> | undefined;
  let stdout = "";
  for await (const ev of run) {
    if (ev.event === "exec_event") {
      const { text } = ev.payload as { text?: string };
      if (text) stdout += text;
    } else if (ev.event === "step_complete") {
      finalState = ev.payload as Record<string, unknown>;
    }
  }

  const version = finalState?.[versionKey!] as string | undefined;
  const report = finalState?.[reportKey!] as string | undefined;

  expect(version).toBeTruthy();
  expect(version?.startsWith("v")).toBe(true);
  expect(stdout).toContain("Node version from file:");
  expect(report).toBeTruthy();
  expect(() => JSON.parse(report!)).not.toThrow();
  expect(report).toContain("capturedAt");
  expect(run.status).toBe("completed");
});
