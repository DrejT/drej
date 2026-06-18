import { DrejClient } from "../packages/sdks/typescript/src/index";

const client = new DrejClient({ baseUrl: process.env.DREJ_API_URL ?? "http://localhost:6000" });

const workflowId = `hello-world-${Date.now()}`;

console.log(`Running workflow ${workflowId}...`);

for await (const ev of client.runWorkflow(workflowId, [
  {
    type: "create_sandbox",
    image: { uri: "ubuntu:22.04" },
    entrypoint: ["tail", "-f", "/dev/null"],
    resourceLimits: { cpu: "500m", memory: "512Mi" },
  },
  { type: "exec_command", command: 'echo "hello world"' },
  { type: "delete_sandbox" },
])) {
  if (ev.event === "exec_event") {
    const e = ev.payload as { type: string; text?: string };
    if (e.text) process.stdout.write(e.text);
  } else {
    const extra = ev.error ? ` error=${ev.error}` : ev.payload ? ` payload=${JSON.stringify(ev.payload)}` : "";
    console.log(`[${ev.event}] step=${ev.stepIndex}${extra}`);
  }
}
