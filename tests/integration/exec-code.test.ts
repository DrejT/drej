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

test("stateless and stateful Python execution via code-interpreter", async () => {
  const run = await client.run(
    workflow("exec-code-test").sandbox(
      {
        image: { uri: "opensandbox/code-interpreter" },
        entrypoint: ["/opt/code-interpreter/code-interpreter.sh"],
        resourceLimits: { cpu: "500m", memory: "512Mi" },
      },
      (s) => {
        s.execCode(`
import sys, math
print(f"[stateless] Python {sys.version.split()[0]}")
print(f"[stateless] pi = {math.pi:.6f}")
        `.trim());

        s.execCode(`
data = [2**i for i in range(8)]
print(f"[stateful 1] data = {data}")
        `.trim(), { context: { id: "session", language: "python" } });

        s.execCode(`
total = sum(data)
print(f"[stateful 2] sum = {total}")
print(f"[stateful 2] max = {max(data)}")
        `.trim(), { context: { id: "session", language: "python" } });
      },
    ),
  );

  let stdout = "";
  for await (const ev of run) {
    if (ev.event === "exec_event") {
      const { text } = ev.payload as { text?: string };
      if (text) stdout += text;
    }
  }

  expect(run.status).toBe("completed");
  expect(stdout).toContain("pi = 3.141593");
  expect(stdout).toContain("[stateful 1] data =");
  expect(stdout).toContain("sum = 255");
  expect(stdout).toContain("max = 128");
});
