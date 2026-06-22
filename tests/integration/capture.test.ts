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

test("captured exec output is available in finalState and interpolated in later steps", async () => {
  let nodeVersionKey: string;
  let infoKey: string;

  const run = await client.run(
    workflow("capture-test").sandbox(
      { image: { uri: "node:20-slim" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
      (s) => {
        const nodeVersion = s.exec("node -e \"process.stdout.write(process.version)\"", { capture: true });
        nodeVersionKey = nodeVersion.key;

        s.exec(`echo "Running on Node ${nodeVersion}"`);

        s.exec("echo '{\"node\":\"'\"$NODE_VERSION\"'\"}' > /tmp/info.json", {
          envs: { NODE_VERSION: `${nodeVersion}` },
        });

        const info = s.exec("cat /tmp/info.json", { capture: true });
        infoKey = info.key;
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

  const nodeVersion = finalState?.[nodeVersionKey!] as string | undefined;
  const info = finalState?.[infoKey!] as string | undefined;

  expect(nodeVersion).toBeTruthy();
  expect(nodeVersion?.startsWith("v")).toBe(true);
  expect(stdout).toContain("Running on Node");
  expect(info).toBeTruthy();
  expect(info).toContain('"node"');
  expect(run.status).toBe("completed");
});
