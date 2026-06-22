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

test("exec output is streamed and run completes", async () => {
  const run = await client.run(
    workflow("hello-world-test").sandbox(
      { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
      (s) => { s.exec('echo "hello world"'); },
    ),
  );

  let stdout = "";
  for await (const ev of run) {
    if (ev.event === "exec_event") {
      const { text } = ev.payload as { text?: string };
      if (text) stdout += text;
    }
  }

  expect(stdout).toContain("hello world");
  expect(run.status).toBe("completed");
});
