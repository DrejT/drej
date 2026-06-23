import { Drej } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});
await client.connect();

const sb = await client.sandbox({
  image: "ubuntu:22.04",
  resources: { cpu: "500m", memory: "512Mi" },
  name: "hello-world",
});

console.log(`Sandbox ID: ${sb.sandboxId}`);

try {
  await sb.exec('echo "hello world"').pipe(process.stdout);
} finally {
  await sb.close();
}

await client.close();
