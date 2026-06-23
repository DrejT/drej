/**
 * Demonstrates the Sandbox file operations API:
 * writeFile, readFile, moveFile, deleteFile, searchFiles, listDirectory
 */
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
  resources: { cpu: "500m", memory: "256Mi" },
  name: "file-ops-demo",
});

console.log(`Sandbox ID: ${sb.sandboxId}\n`);

try {
  // Write files
  await sb.writeFile("/workspace/src/index.ts", 'export const VERSION = "0.0.0";\n');
  await sb.writeFile("/workspace/src/util.ts", 'export const helper = () => "ok";\n');
  await sb.exec("ls -la /workspace/src/").pipe(process.stdout);

  // Search for files
  const tsFiles = await sb.searchFiles("*.ts", "/workspace/src");
  console.log("TS files:", tsFiles);

  // Read a file
  const indexSrc = await sb.readFile("/workspace/src/index.ts");
  console.log("Before patch:", indexSrc.trim());

  // Patch the file (via exec since we don't have replaceInFiles in the new API)
  await sb.exec("sed -i 's/0.0.0/1.2.3/' /workspace/src/index.ts");
  const afterPatch = await sb.readFile("/workspace/src/index.ts");
  console.log("After patch:", afterPatch.trim());

  // Move a file
  await sb.exec("mkdir -p /workspace/dist");
  await sb.moveFile("/workspace/src/index.ts", "/workspace/dist/index.ts");

  // List directory
  const distEntries = await sb.listDirectory("/workspace/dist");
  console.log("Dist entries:", distEntries.map((e: { path: string }) => e.path));

  // Delete a file
  await sb.deleteFile("/workspace/src/util.ts");
  await sb.exec("ls /workspace/src/ 2>/dev/null || echo 'src is empty'").pipe(process.stdout);
} finally {
  await sb.close();
}

await client.close();
