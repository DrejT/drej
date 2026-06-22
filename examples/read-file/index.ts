/**
 * Demonstrates readFile() — reading a file from the sandbox into workflow state
 * for interpolation in later steps or inspection after the run completes.
 */
import { Drej, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://localhost:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter: new SQLiteAdapter("./ledger.db"),
});
await client.connect();

let versionKey: string, reportKey: string;

const { output, state } = await client.run(
  workflow("read-file-demo").sandbox(
    { image: { uri: "node:20-slim" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => {
      s.exec("node -e \"require('fs').writeFileSync('/tmp/version.txt', process.version)\"");
      const version = s.readFile("/tmp/version.txt");
      versionKey = version.key;
      s.exec(`echo "Node version from file: ${version}"`);

      s.writeFile("/tmp/report.json", JSON.stringify({ capturedAt: new Date().toISOString() }));
      const report = s.readFile("/tmp/report.json");
      reportKey = report.key;
      s.exec(`echo "Report: ${report}"`);
    },
  ),
).result();

console.log(output);
console.log("--- captured state ---");
console.log("version:", state[versionKey!]);
console.log("report:", state[reportKey!]);

await client.close();
