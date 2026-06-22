/**
 * Demonstrates all control-flow builder methods:
 *   retry    — retries a flaky command with exponential backoff
 *   when     — branches on workflow state
 *   forEach  — iterates a list; item resolves via template literal
 *   parallel — runs branches concurrently inside the same sandbox
 */
import { Drej, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});
await client.connect();

const run = await client.run(
  workflow("control-flow").sandbox(
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
        (s) => { s.exec('echo "[when] /etc/hostname exists"'); },
        (s) => { s.exec('echo "[when] /etc/hostname missing"'); },
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

console.log(`Run ID: ${run.id}\n`);
await run.pipe(process.stdout);

await client.close();
