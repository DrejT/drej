/**
 * Integration test for control-flow example.
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

const run = await client.run(
  workflow("control-flow-test").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "512Mi" } },
    (s) => {
      // retry: coin flip — 5 attempts with exponential backoff
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

      // when: /etc/hostname always exists in ubuntu — expects then-branch
      s.exec("test -f /etc/hostname");
      s.when(
        { op: "eq", field: "exitCode", value: 0 },
        (s) => { s.exec('echo "[when] then-branch: /etc/hostname exists"'); },
        (s) => { s.exec('echo "[when] else-branch: /etc/hostname missing"'); },
      );

      // forEach: writes 3 files
      s.forEach(["alpha.txt", "beta.txt", "gamma.txt"], { as: "filename" }, (s, filename) => {
        s.exec(`echo "[loop] writing /tmp/${filename}" && echo "hello" > /tmp/${filename}`);
      });

      // parallel: both branches run concurrently
      s.parallel((p) => {
        p.branch((b) => { b.exec('sleep 1 && echo "[parallel 0] done"'); });
        p.branch((b) => { b.exec('sleep 1 && echo "[parallel 1] done"'); });
      });

      // verify all loop files are present
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

let failed = false;
function assert(label: string, ok: boolean, got?: unknown) {
  if (!ok) {
    console.error(`FAIL: ${label}${got !== undefined ? ` — got: ${JSON.stringify(got)}` : ""}`);
    failed = true;
  }
}

assert("retry eventually succeeds",         run.status === "completed",                   run.status);
assert("retry success message in stdout",   stdout.includes("[retry] heads — success"),    stdout);
assert("when takes then-branch",            stdout.includes("[when] then-branch"),         stdout);
assert("forEach writes alpha.txt",          stdout.includes("[loop] writing /tmp/alpha.txt"), stdout);
assert("forEach writes beta.txt",           stdout.includes("[loop] writing /tmp/beta.txt"),  stdout);
assert("forEach writes gamma.txt",          stdout.includes("[loop] writing /tmp/gamma.txt"), stdout);
assert("parallel branch 0 completes",       stdout.includes("[parallel 0] done"),          stdout);
assert("parallel branch 1 completes",       stdout.includes("[parallel 1] done"),          stdout);
assert("verify step sees all loop files",   stdout.includes("[verify] all files present"), stdout);

console.log(failed ? "\nsome assertions failed" : "\n✓ all assertions passed");
await client.close();
if (failed) process.exit(1);
