import { DrejClient, workflow } from "../packages/sdks/typescript/src/index";

const client = new DrejClient({ baseUrl: process.env.DREJ_API_URL ?? "http://localhost:6000" });

const w = workflow("hello-world").sandbox(
  { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "512Mi" } },
  (s) => s.exec('echo "hello world"'),
);

const run = await client.run(w);
console.log(`Run ID: ${run.id} (workflow: ${run.name})`);

for await (const ev of run) {
  if (ev.event === "exec_event") {
    const e = ev.payload as { type: string; text?: string };
    if (e.text) process.stdout.write(e.text);
  } else {
    const extra = ev.error ? ` error=${ev.error}` : ev.payload ? ` payload=${JSON.stringify(ev.payload)}` : "";
    console.log(`[${ev.event}] step=${ev.stepIndex}${extra}`);
  }
}
