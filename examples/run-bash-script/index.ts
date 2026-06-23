import { Drej } from "drej";
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

const sb = await client.sandbox({
  image: "ubuntu:22.04",
  resources: { cpu: "500m", memory: "512Mi" },
  name: "bash-script",
});

console.log(`Sandbox ID: ${sb.sandboxId}\n`);

try {
  await sb.exec(script).pipe(process.stdout);
} finally {
  await sb.close();
}

await client.close();
