/**
 * Live integration test for all file ops.
 * Runs against a real sandbox and asserts on the captured state.
 *
 * Run: bun tests/integration.ts
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

// Declare captures outside so assertions can reference them after the run.
let srcFilesKey: string, indexSrcKey: string, afterPatchKey: string, bundleInfoKey: string, distEntriesKey: string;

const run = await client.run(
  workflow("file-ops-integration").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => {
      s.createDirectory("/workspace/src");
      s.createDirectory("/workspace/dist");

      s.writeFile("/workspace/src/index.ts", 'export const VERSION = "0.0.0";\n');
      s.writeFile("/workspace/src/util.ts",  'export const helper = () => "ok";\n');

      s.exec("printf '#!/bin/sh\\necho built' > /workspace/build.sh");
      s.setPermissions("/workspace/build.sh", "755");
      s.exec("ls -la /workspace/build.sh");

      const srcFiles  = s.searchFiles("*.ts", { dir: "/workspace/src" });
      srcFilesKey = srcFiles.key;
      s.exec(`echo "TS files: ${srcFiles}"`);

      const indexSrc  = s.readFile("/workspace/src/index.ts");
      indexSrcKey = indexSrc.key;
      s.exec(`echo "Before patch: ${indexSrc}"`);

      s.replaceInFiles([{ path: "/workspace/src/index.ts", old: "0.0.0", new: "1.2.3" }]);
      const afterPatch = s.readFile("/workspace/src/index.ts");
      afterPatchKey = afterPatch.key;
      s.exec(`echo "After patch: ${afterPatch}"`);

      s.moveFile("/workspace/src/index.ts", "/workspace/dist/index.ts");
      const bundleInfo  = s.getFileInfo("/workspace/dist/index.ts");
      bundleInfoKey = bundleInfo.key;

      const distEntries = s.listDirectory("/workspace/dist");
      distEntriesKey = distEntries.key;

      s.deleteFile("/workspace/src/util.ts");
      s.deleteDirectory("/workspace/src");

      // forEach over listDirectory: visit each file in /workspace/dist
      const distForEach = s.listDirectory("/workspace/dist");
      s.forEach(distForEach, (s, entry) => {
        s.exec(`echo "entry-path: ${entry.path}"`);
      });
    },
  ),
);

console.log(`Run ID: ${run.id}\n`);

let finalState: Record<string, unknown> | undefined;
let stdout = "";

for await (const ev of run) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) { process.stdout.write(text); stdout += text; }
  } else if (ev.event === "step_complete") {
    finalState = ev.payload as Record<string, unknown>;
  } else if (ev.event !== "run_started" && ev.event !== "checkpoint") {
    const extra = ev.error ? ` error=${ev.error}` : "";
    console.log(`[${ev.event}] step=${ev.stepIndex}${extra}`);
  }
}

// ── assertions ────────────────────────────────────────────────────────────────

if (!finalState) {
  console.error("\nFAIL: workflow did not produce final state");
  process.exit(1);
}

let failed = false;

function assert(label: string, ok: boolean, got?: unknown) {
  if (!ok) {
    console.error(`FAIL: ${label}${got !== undefined ? ` — got: ${JSON.stringify(got)}` : ""}`);
    failed = true;
  }
}

const files     = finalState[srcFilesKey!] as string[];
const indexSrc  = finalState[indexSrcKey!] as string;
const afterPatch = finalState[afterPatchKey!] as string;
const info      = finalState[bundleInfoKey!] as { size: number; type: string };
const entries   = finalState[distEntriesKey!] as Array<{ path: string }>;

assert("searchFiles found index.ts",    files?.some((f) => f.endsWith("index.ts")), files);
assert("searchFiles found util.ts",     files?.some((f) => f.endsWith("util.ts")),  files);
assert("searchFiles excludes build.sh", files?.every((f) => !f.endsWith("build.sh")), files);

assert("readFile captured original version", indexSrc?.includes("0.0.0"),  indexSrc);
assert("replaceInFiles patched version",     afterPatch?.includes("1.2.3"), afterPatch);

assert("getFileInfo: not a directory", info?.type === "file", info?.type);
assert("getFileInfo: size > 0",        (info?.size ?? 0) > 0, info?.size);

assert("listDirectory sees moved file", entries?.some((e) => e.path?.endsWith("index.ts")), entries);

assert("forEach(listDirectory): entry.path interpolated in exec", stdout.includes("entry-path: /workspace/dist/index.ts"), stdout);

console.log(failed ? "\nsome assertions failed" : "\n✓ all assertions passed");
if (failed) process.exit(1);

await client.close();
