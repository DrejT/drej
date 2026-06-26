/**
 * Demonstrates @drej/workflow control-flow primitives:
 *   retry   — retries a flaky command with exponential backoff
 *   when    — branches based on last exitCode
 *   forEach — iterates over a list of items
 *
 * For multi-sandbox parallelism, use workflow(client).parallel([...]).
 */
import { Drej } from "drej";
import { workflow } from "@drej/workflow";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
  useServerProxy: process.env.USE_SERVER_PROXY !== "false",
});

await workflow(client)
  .sandbox(
    { image: "ubuntu:22.04", resources: { cpu: "500m", memory: "512Mi" }, name: "control-flow" },
    (sb) => {
      // retry — fails the first 2 attempts, succeeds on the 3rd
      sb.retry(
        5,
        (sb) => {
          sb.exec(
            'COUNT=$(cat /tmp/attempt 2>/dev/null || echo 0); COUNT=$((COUNT+1)); echo $COUNT > /tmp/attempt; echo "[retry] attempt $COUNT"; [ $COUNT -ge 3 ] && echo "[retry] succeeded" || { echo "[retry] failing"; exit 1; }',
          );
        },
        { delayMs: 200, backoff: "exponential" },
      );

      // when — branch based on the previous exec's exit code
      sb.exec("test -f /etc/hostname", { strict: false });
      sb.when(
        (ctx) => ctx.exitCode === 0,
        (sb) => {
          sb.exec('echo "[when] /etc/hostname exists"');
        },
        (sb) => {
          sb.exec('echo "[when] /etc/hostname missing"');
        },
      );

      // forEach — run a command for each item in a list
      sb.forEach(["alpha.txt", "beta.txt", "gamma.txt"], (sb, item) => {
        sb.exec(`echo "[loop] writing /tmp/${item}" && echo hello > /tmp/${item}`);
      });

      sb.exec("ls /tmp/*.txt && echo '[verify] all files present'");
    },
  )
  .pipe(process.stdout);
