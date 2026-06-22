import { DrejClient, workflow, StepTimeoutError } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { beforeAll, afterAll, test, expect, describe } from "bun:test";

let client: DrejClient;

const image = { uri: "ubuntu:22.04" };
const resourceLimits = { cpu: "500m", memory: "256Mi" };

beforeAll(async () => {
  client = new DrejClient({
    baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
    apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
    adapter: new SQLiteAdapter(":memory:"),
  });
  await client.connect();
});

afterAll(() => client.close());

describe("cancellation and timeouts", () => {
  test("per-step timeoutMs: throws StepTimeoutError, subsequent steps do not run", async () => {
    const run = await client.run(
      workflow("cancellation-timeout-test").sandbox({ image, resourceLimits }, (s) => {
        s.exec("sleep 30", { timeoutMs: 500 });
        s.exec("echo 'should not run'");
      }),
    );

    let caughtError: StepTimeoutError | undefined;
    let stdout = "";
    try {
      for await (const ev of run) {
        if (ev.event === "exec_event") {
          const { text } = ev.payload as { text?: string };
          if (text) stdout += text;
        }
      }
    } catch (e) {
      if (e instanceof StepTimeoutError) caughtError = e;
      else throw e;
    }

    expect(caughtError).toBeInstanceOf(StepTimeoutError);
    expect(caughtError?.timeoutMs).toBe(500);
    expect(stdout).not.toContain("should not run");
    expect(run.status).toBe("failed");
  });

  test("global stepTimeoutMs: applies to steps without their own timeoutMs", async () => {
    const run = await client.run(
      workflow("cancellation-global-timeout-test").sandbox({ image, resourceLimits }, (s) => {
        s.exec("sleep 30");
      }),
      { stepTimeoutMs: 500 },
    );

    let caughtError: StepTimeoutError | undefined;
    try {
      for await (const ev of run) { void ev; }
    } catch (e) {
      if (e instanceof StepTimeoutError) caughtError = e;
      else throw e;
    }

    expect(caughtError).toBeInstanceOf(StepTimeoutError);
    expect(run.status).toBe("failed");
  });

  test("run.cancel(): loop ends cleanly with no error, status is cancelled", async () => {
    const run = await client.run(
      workflow("cancellation-cancel-test").sandbox({ image, resourceLimits }, (s) => {
        s.exec("echo 'step 1'");
        s.exec("sleep 30");
        s.exec("echo 'step 3'");
      }),
    );

    let errorThrown = false;
    let stdout = "";
    try {
      for await (const ev of run) {
        if (ev.event === "exec_event") {
          const { text } = ev.payload as { text?: string };
          if (text) stdout += text;
          run.cancel();
        }
      }
    } catch {
      errorThrown = true;
    }

    expect(errorThrown).toBe(false);
    expect(run.status).toBe("cancelled");
    expect(stdout).not.toContain("step 3");
  });

  test("break from for-await: loop ends cleanly with no error, status is cancelled", async () => {
    const run = await client.run(
      workflow("cancellation-break-test").sandbox({ image, resourceLimits }, (s) => {
        s.exec("echo 'step 1'");
        s.exec("sleep 30");
      }),
    );

    let errorThrown = false;
    try {
      for await (const ev of run) {
        if (ev.event === "exec_event") break;
      }
    } catch {
      errorThrown = true;
    }

    expect(errorThrown).toBe(false);
    expect(run.status).toBe("cancelled");
  });
});
