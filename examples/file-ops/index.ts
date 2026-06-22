/**
 * Demonstrates the file ops API with ref() — typed state references.
 *
 * Covers: createDirectory, writeFile, setPermissions, searchFiles, readFile,
 *         replaceInFiles, getFileInfo, moveFile, listDirectory, deleteFile,
 *         deleteDirectory
 *
 * Also acts as a live integration test: assertions at the bottom verify real
 * sandbox behavior. Run: bun index.ts
 *
 * Requires: uvx opensandbox-server (see root CLAUDE.md for ~/.sandbox.toml)
 */
import { DrejClient, ref, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new DrejClient({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});

await client.connect();

// Declare refs as typed JS variables — no "{{key}}" strings in user code.
const srcFiles  = ref<string[]>("srcFiles");
const indexSrc  = ref<string>("indexSrc");
const afterPatch = ref<string>("afterPatch");
const bundleInfo = ref<{ size: number; isDirectory: boolean }>("bundleInfo");
const distEntries = ref<Array<{ path: string; type: string }>>("distEntries");

const run = await client.run(
  workflow("file-ops-demo").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) =>
      s
        // 1. Create a project layout
        .createDirectory("/workspace/src")
        .createDirectory("/workspace/dist")

        // 2. Write source files
        .writeFile("/workspace/src/index.ts", 'export const VERSION = "0.0.0";\n')
        .writeFile("/workspace/src/util.ts",  'export const helper = () => "ok";\n')

        // 3. Make a build script executable
        .exec("printf '#!/bin/sh\\necho built' > /workspace/build.sh")
        .setPermissions("/workspace/build.sh", "755")
        .exec("ls -la /workspace/build.sh")

        // 4. Find all TypeScript source files → srcFiles: string[]
        .searchFiles("*.ts", { as: srcFiles, dir: "/workspace/src" })
        .exec(`echo "TS files: ${srcFiles}"`)

        // 5. Read a file into state, interpolate it in a later step
        .readFile("/workspace/src/index.ts", { as: indexSrc })
        .exec(`echo "Before patch: ${indexSrc}"`)

        // 6. Patch the version string in-place, read it back to confirm
        .replaceInFiles([{ path: "/workspace/src/index.ts", old: "0.0.0", new: "1.2.3" }])
        .readFile("/workspace/src/index.ts", { as: afterPatch })
        .exec(`echo "After patch: ${afterPatch}"`)

        // 7. Move patched file to dist, stat it
        .moveFile("/workspace/src/index.ts", "/workspace/dist/index.ts")
        .getFileInfo("/workspace/dist/index.ts", { as: bundleInfo })

        // 8. List dist to confirm move
        .listDirectory("/workspace/dist", { as: distEntries })

        // 9. Clean up
        .deleteFile("/workspace/src/util.ts")
        .deleteDirectory("/workspace/src"),
  ),
);

// ── stream ────────────────────────────────────────────────────────────────────

console.log(`Run ID: ${run.id}\n`);

let finalState: Record<string, unknown> | undefined;

for await (const ev of run) {
  if (ev.event === "exec_event") {
    const { text } = ev.payload as { text?: string };
    if (text) process.stdout.write(text);
  } else if (ev.event === "step_complete") {
    finalState = ev.payload as Record<string, unknown>;
  } else if (ev.event !== "run_started") {
    const extra = ev.error ? ` error=${ev.error}` : "";
    console.log(`[${ev.event}] step=${ev.stepIndex}${extra}`);
  }
}

// ── assertions (live integration test) ────────────────────────────────────────

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

const files = finalState.srcFiles as string[];
assert("searchFiles found index.ts",  files?.some((f) => f.endsWith("index.ts")));
assert("searchFiles found util.ts",   files?.some((f) => f.endsWith("util.ts")));
assert("searchFiles excludes build.sh", files?.every((f) => !f.endsWith("build.sh")));

assert("readFile captured original version",
  (finalState.indexSrc as string)?.includes("0.0.0"), finalState.indexSrc);

assert("replaceInFiles patched version",
  (finalState.afterPatch as string)?.includes("1.2.3"), finalState.afterPatch);

const info = finalState.bundleInfo as { size: number; isDirectory: boolean };
assert("getFileInfo: not a directory", info && !info.isDirectory, info);
assert("getFileInfo: size > 0",        info && info.size > 0,     info?.size);

const entries = finalState.distEntries as Array<{ path: string }>;
assert("listDirectory sees moved file", entries?.some((e) => e.path?.endsWith("index.ts")), entries);

console.log(failed ? "\nsome assertions failed" : "\n✓ all assertions passed");
if (failed) process.exit(1);

await client.close();
