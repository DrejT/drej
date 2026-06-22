/**
 * Demonstrates the file ops API:
 * createDirectory, writeFile, setPermissions, searchFiles, readFile,
 * replaceInFiles, getFileInfo, moveFile, listDirectory, deleteFile, deleteDirectory
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
  workflow("file-ops-demo").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => {
      s.createDirectory("/workspace/src");
      s.createDirectory("/workspace/dist");

      s.writeFile("/workspace/src/index.ts", 'export const VERSION = "0.0.0";\n');
      s.writeFile("/workspace/src/util.ts",  'export const helper = () => "ok";\n');

      s.exec("printf '#!/bin/sh\\necho built' > /workspace/build.sh");
      s.setPermissions("/workspace/build.sh", "755");
      s.exec("ls -la /workspace/build.sh");

      const srcFiles = s.searchFiles("*.ts", { dir: "/workspace/src" });
      s.exec(`echo "TS files: ${srcFiles}"`);

      const indexSrc = s.readFile("/workspace/src/index.ts");
      s.exec(`echo "Before patch: ${indexSrc}"`);

      s.replaceInFiles([{ path: "/workspace/src/index.ts", old: "0.0.0", new: "1.2.3" }]);
      const afterPatch = s.readFile("/workspace/src/index.ts");
      s.exec(`echo "After patch: ${afterPatch}"`);

      s.moveFile("/workspace/src/index.ts", "/workspace/dist/index.ts");
      const bundleInfo = s.getFileInfo("/workspace/dist/index.ts");
      s.exec(`echo "File info: ${bundleInfo}"`);

      const distEntries = s.listDirectory("/workspace/dist");
      s.exec(`echo "Dist entries: ${distEntries}"`);

      s.deleteFile("/workspace/src/util.ts");
      s.deleteDirectory("/workspace/src");
    },
  ),
);

console.log(`Run ID: ${run.id}\n`);
await run.pipe(process.stdout);

await client.close();
