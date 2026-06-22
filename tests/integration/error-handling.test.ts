import { Drej, workflow, CommandError } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { beforeAll, afterAll, test, expect, describe } from "bun:test";

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

describe("error handling", () => {
  test("non-strict exec: workflow continues, when() handles the failure", async () => {
    const run = await client.run(
      workflow("error-handling-a-test").sandbox(
        { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
        (s) => {
          s.exec("exit 1");
          s.when(
            { op: "eq", field: "exitCode", value: 0 },
            (s) => { s.exec("echo success"); },
            (s) => { s.exec("echo 'command failed, handled gracefully'"); },
          );
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
    expect(stdout).toContain("handled gracefully");
    expect(stdout).not.toContain("success");
  });

  test("strict exec: CommandError thrown with correct exit code", async () => {
    const run = await client.run(
      workflow("error-handling-b-test").sandbox(
        { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
        (s) => {
          s.exec("echo 'about to fail'");
          s.exec("exit 42", { strict: true });
          s.exec("echo 'this line never runs'");
        },
      ),
    );

    let caughtError: CommandError | undefined;
    let stdout = "";
    try {
      for await (const ev of run) {
        if (ev.event === "exec_event") {
          const { text } = ev.payload as { text?: string };
          if (text) stdout += text;
        }
      }
    } catch (e) {
      if (e instanceof CommandError) caughtError = e;
      else throw e;
    }

    expect(caughtError).toBeInstanceOf(CommandError);
    expect(caughtError?.exitCode).toBe(42);
    expect(stdout).not.toContain("this line never runs");
  });
});
