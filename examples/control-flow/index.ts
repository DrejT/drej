/**
 * Demonstrates all control-flow builder methods:
 *   retry    — retries a flaky command with exponential backoff
 *   when     — branches on workflow state
 *   forEach  — iterates a list; item resolves via template literal
 *   parallel — runs branches concurrently inside the same sandbox
 */
import { DrejClient, workflow } from "drej";
import { SQLiteAdapter } from "@drejt/sqlite";

const client = new DrejClient({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});

await client.connect();

const w = workflow("control-flow").sandbox(
  { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "512Mi" } },
  (s) =>
    s
      // retry: coin flip, fails ~50% of the time
      .retry(
        5,
        (s) =>
          s.exec(`
            R=$((RANDOM % 2))
            if [ $R -eq 0 ]; then echo "[retry] tails — failing"; exit 1; fi
            echo "[retry] heads — success"
          `),
        { delayMs: 200, backoff: "exponential" },
      )

      // when: branch on the exit code of the previous exec step
      // test -f exits 0 if the file exists, 1 if it doesn't
      .exec('test -f /etc/hostname')
      .when(
        { op: "eq", field: "exitCode", value: 0 },
        (s) => s.exec('echo "[when] then-branch: /etc/hostname exists"'),
        (s) => s.exec('echo "[when] else-branch: /etc/hostname missing"'),
      )

      // forEach: item is a LoopVar — use directly in a template literal
      .forEach(["alpha.txt", "beta.txt", "gamma.txt"], { as: "filename" }, (s, filename) =>
        s.exec(`echo "[loop] writing /tmp/${filename}" && echo "hello" > /tmp/${filename}`),
      )

      // parallel: both branches sleep 1s concurrently — wall time ~1s not 2s
      .parallel((p) =>
        p
          .branch((s) => s.exec('sleep 1 && echo "[parallel 0] done"'))
          .branch((s) => s.exec('sleep 1 && echo "[parallel 1] done"')),
      )

      // verify loop files survived
      .exec("ls /tmp/*.txt && echo '[verify] all files present'"),
);

const run = await client.run(w);
console.log(`Run ID: ${run.id} (workflow: ${run.name})\n`);

for await (const ev of run) {
  if (ev.event === "exec_event") {
    const e = ev.payload as { type: string; text?: string };
    if (e.text) process.stdout.write(e.text);
  } else {
    const branch = (ev as { branch?: number }).branch !== undefined ? ` branch=${(ev as { branch?: number }).branch}` : "";
    const extra = ev.error ? ` error=${ev.error}` : "";
    console.log(`[${ev.event}] step=${ev.stepIndex}${branch}${extra}`);
  }
}

await client.close();
