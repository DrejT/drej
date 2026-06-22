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

test("retry, when, forEach, and parallel all execute correctly", async () => {
  const run = await client.run(
    workflow("control-flow-test").sandbox(
      { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "512Mi" } },
      (s) => {
        s.retry(
          5,
          (r) => {
            r.exec(`
              R=$((RANDOM % 2))
              if [ $R -eq 0 ]; then echo "[retry] tails — failing"; exit 1; fi
              echo "[retry] heads — success"
            `);
          },
          { delayMs: 200, backoff: "exponential" },
        );

        s.exec("test -f /etc/hostname");
        s.when(
          { op: "eq", field: "exitCode", value: 0 },
          (s) => { s.exec('echo "[when] then-branch: /etc/hostname exists"'); },
          (s) => { s.exec('echo "[when] else-branch: /etc/hostname missing"'); },
        );

        s.forEach(["alpha.txt", "beta.txt", "gamma.txt"], { as: "filename" }, (s, filename) => {
          s.exec(`echo "[loop] writing /tmp/${filename}" && echo "hello" > /tmp/${filename}`);
        });

        s.parallel((p) => {
          p.branch((b) => { b.exec('sleep 1 && echo "[parallel 0] done"'); });
          p.branch((b) => { b.exec('sleep 1 && echo "[parallel 1] done"'); });
        });

        s.exec("ls /tmp/*.txt && echo '[verify] all files present'");
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
  expect(stdout).toContain("[retry] heads — success");
  expect(stdout).toContain("[when] then-branch");
  expect(stdout).toContain("[loop] writing /tmp/alpha.txt");
  expect(stdout).toContain("[loop] writing /tmp/beta.txt");
  expect(stdout).toContain("[loop] writing /tmp/gamma.txt");
  expect(stdout).toContain("[parallel 0] done");
  expect(stdout).toContain("[parallel 1] done");
  expect(stdout).toContain("[verify] all files present");
});
