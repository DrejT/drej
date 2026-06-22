/**
 * Demonstrates the file ops API using plain JS variables.
 *
 * Covers: createDirectory, writeFile, setPermissions, searchFiles, readFile,
 *         replaceInFiles, getFileInfo, moveFile, listDirectory, deleteFile,
 *         deleteDirectory
 *
 * Run: bun index.ts
 * Integration test: bun tests/integration.ts
 *
 * Requires: uvx opensandbox-server (see root CLAUDE.md for ~/.sandbox.toml)
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
  workflow("file-ops-demo").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => {
      // 1. Create a project layout
      s.createDirectory("/workspace/src");
      s.createDirectory("/workspace/dist");

      // 2. Write source files
      s.writeFile("/workspace/src/index.ts", 'export const VERSION = "0.0.0";\n');
      s.writeFile("/workspace/src/util.ts",  'export const helper = () => "ok";\n');

      // 3. Make a build script executable
      s.exec("printf '#!/bin/sh\\necho built' > /workspace/build.sh");
      s.setPermissions("/workspace/build.sh", "755");
      s.exec("ls -la /workspace/build.sh");

      // 4. Find all TypeScript source files
      const srcFiles = s.searchFiles("*.ts", { dir: "/workspace/src" });
      s.exec(`echo "TS files: ${srcFiles}"`);

      // 5. Read a file into state, interpolate it in a later step
      const indexSrc = s.readFile("/workspace/src/index.ts");
      s.exec(`echo "Before patch: ${indexSrc}"`);

      // 6. Patch the version string in-place, read it back to confirm
      s.replaceInFiles([{ path: "/workspace/src/index.ts", old: "0.0.0", new: "1.2.3" }]);
      const afterPatch = s.readFile("/workspace/src/index.ts");
      s.exec(`echo "After patch: ${afterPatch}"`);

      // 7. Move patched file to dist, stat it
      s.moveFile("/workspace/src/index.ts", "/workspace/dist/index.ts");
      const bundleInfo = s.getFileInfo("/workspace/dist/index.ts");
      s.exec(`echo "File info: ${bundleInfo}"`);

      // 8. List dist to confirm move
      const distEntries = s.listDirectory("/workspace/dist");
      s.exec(`echo "Dist entries: ${distEntries}"`);

      // 9. Clean up
      s.deleteFile("/workspace/src/util.ts");
      s.deleteDirectory("/workspace/src");
    },
  ),
);

console.log(`Run ID: ${run.id}\n`);

for await (const ev of run) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) process.stdout.write(text);
  } else if (ev.event !== "run_started" && ev.event !== "step_complete" && ev.event !== "checkpoint") {
    const extra = ev.error ? ` error=${ev.error}` : "";
    console.log(`[${ev.event}] step=${ev.stepIndex}${extra}`);
  }
}

await client.close();
