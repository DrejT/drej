/**
 * Integration test for read-file example.
 * Run: bun tests/integration.ts
 */
import { DrejClient, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new DrejClient({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});

await client.connect();

let versionKey: string, reportKey: string;

const run = await client.run(
  workflow("read-file-test").sandbox(
    { image: { uri: "node:20-slim" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => {
      s.exec("node -e \"require('fs').writeFileSync('/tmp/version.txt', process.version)\"");
      const version = s.readFile("/tmp/version.txt");
      versionKey = version.key;
      s.exec(`echo "Node version from file: ${version}"`);

      s.writeFile("/tmp/report.json", JSON.stringify({ capturedAt: new Date().toISOString() }));
      const report = s.readFile("/tmp/report.json");
      reportKey = report.key;
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

let failed = false;
function assert(label: string, ok: boolean, got?: unknown) {
  if (!ok) {
    console.error(`FAIL: ${label}${got !== undefined ? ` — got: ${JSON.stringify(got)}` : ""}`);
    failed = true;
  }
}

const version = finalState?.[versionKey!] as string | undefined;
const report  = finalState?.[reportKey!] as string | undefined;

assert("version captured",                !!version,                          version);
assert("version starts with 'v'",         version?.startsWith("v") ?? false,  version);
assert("stdout interpolates version",     stdout.includes("Node version from file:"), stdout);

assert("report captured",                 !!report,                            report);
assert("report is valid JSON",            (() => { try { JSON.parse(report!); return true; } catch { return false; } })(), report);
assert("report contains capturedAt",      report?.includes("capturedAt") ?? false, report);

assert("run completed",                   run.status === "completed",          run.status);

console.log(failed ? "\nsome assertions failed" : "\n✓ all assertions passed");
await client.close();
if (failed) process.exit(1);
