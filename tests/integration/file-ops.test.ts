import { Drej, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { beforeAll, afterAll, test, expect } from "bun:test";

let client: Drej;

beforeAll(async () => {
  client = new Drej({
    baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
    apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
    adapter: new SQLiteAdapter(":memory:"),
  });
  await client.connect();
});

afterAll(() => client.close());

test("file ops: create, write, search, read, patch, move, list, delete", async () => {
  let srcFilesKey: string;
  let indexSrcKey: string;
  let afterPatchKey: string;
  let bundleInfoKey: string;
  let distEntriesKey: string;

  const run = await client.run(
    workflow("file-ops-integration").sandbox(
      { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
      (s) => {
        s.createDirectory("/workspace/src");
        s.createDirectory("/workspace/dist");

        s.writeFile("/workspace/src/index.ts", 'export const VERSION = "0.0.0";\n');
        s.writeFile("/workspace/src/util.ts", 'export const helper = () => "ok";\n');

        s.exec("printf '#!/bin/sh\\necho built' > /workspace/build.sh");
        s.setPermissions("/workspace/build.sh", "755");
        s.exec("ls -la /workspace/build.sh");

        const srcFiles = s.searchFiles("*.ts", { dir: "/workspace/src" });
        srcFilesKey = srcFiles.key;
        s.exec(`echo "TS files: ${srcFiles}"`);

        const indexSrc = s.readFile("/workspace/src/index.ts");
        indexSrcKey = indexSrc.key;
        s.exec(`echo "Before patch: ${indexSrc}"`);

        s.replaceInFiles([{ path: "/workspace/src/index.ts", old: "0.0.0", new: "1.2.3" }]);
        const afterPatch = s.readFile("/workspace/src/index.ts");
        afterPatchKey = afterPatch.key;
        s.exec(`echo "After patch: ${afterPatch}"`);

        s.moveFile("/workspace/src/index.ts", "/workspace/dist/index.ts");
        const bundleInfo = s.getFileInfo("/workspace/dist/index.ts");
        bundleInfoKey = bundleInfo.key;

        const distEntries = s.listDirectory("/workspace/dist");
        distEntriesKey = distEntries.key;

        s.deleteFile("/workspace/src/util.ts");
        s.deleteDirectory("/workspace/src");

        const distForEach = s.listDirectory("/workspace/dist");
        s.forEach(distForEach, (s, entry) => {
          s.exec(`echo "entry-path: ${entry.path}"`);
        });
      },
    ),
  );

  let finalState: Record<string, unknown> | undefined;
  let stdout = "";
  for await (const ev of run) {
    if (ev.event === "exec_event") {
      const { text } = ev.payload as { text?: string };
      if (text) stdout += text;
    } else if (ev.event === "step_complete") {
      finalState = ev.payload as Record<string, unknown>;
    }
  }

  expect(finalState).toBeDefined();

  const files = finalState![srcFilesKey!] as string[];
  const indexSrc = finalState![indexSrcKey!] as string;
  const afterPatch = finalState![afterPatchKey!] as string;
  const info = finalState![bundleInfoKey!] as { size: number; type: string };
  const entries = finalState![distEntriesKey!] as Array<{ path: string }>;

  expect(files.some((f) => f.endsWith("index.ts"))).toBe(true);
  expect(files.some((f) => f.endsWith("util.ts"))).toBe(true);
  expect(files.every((f) => !f.endsWith("build.sh"))).toBe(true);

  expect(indexSrc).toContain("0.0.0");
  expect(afterPatch).toContain("1.2.3");

  expect(info.type).toBe("file");
  expect(info.size).toBeGreaterThan(0);

  expect(entries.some((e) => e.path?.endsWith("index.ts"))).toBe(true);

  expect(stdout).toContain("entry-path: /workspace/dist/index.ts");
});
