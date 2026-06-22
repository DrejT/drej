import { Drej, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { beforeAll, afterAll, test, expect } from "bun:test";

let client: Drej;

beforeAll(async () => {
  client = new Drej({
    baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
    apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
    adapter: new SQLiteAdapter(":memory:"),
  });
  await client.connect();
});

afterAll(() => client.close());

test("multi-line bash script executes and produces expected output", async () => {
  const script = `
#!/bin/bash
set -euo pipefail
echo "=== system info ==="
uname -a
echo "=== writing a file and reading it back ==="
echo "hello from drej" > /tmp/drej-test.txt
cat /tmp/drej-test.txt
echo "=== done ==="
  `.trim();

  const run = await client.run(
    workflow("bash-script-test").sandbox(
      { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
      (s) => { s.exec(script); },
    ),
  );

  let stdout = "";
  for await (const ev of run) {
    if (ev.event === "exec_event") {
      const { text } = ev.payload as { text?: string };
      if (text) stdout += text;
    }
  }

  expect(stdout).toContain("=== system info ===");
  expect(stdout).toContain("hello from drej");
  expect(stdout).toContain("=== done ===");
  expect(run.status).toBe("completed");
});
