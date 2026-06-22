import { Drej, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});
await client.connect();

const script = `
#!/bin/bash
set -euo pipefail

echo "=== system info ==="
uname -a
echo ""

echo "=== disk usage ==="
df -h /
echo ""

echo "=== writing a file and reading it back ==="
echo "hello from drej" > /tmp/drej-test.txt
cat /tmp/drej-test.txt
echo ""

echo "=== done ==="
`.trim();

const run = await client.run(
  workflow("bash-script").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "512Mi" } },
    (s) => s.exec(script),
  ),
);

console.log(`Run ID: ${run.id}\n`);
await run.pipe(process.stdout);

await client.close();
