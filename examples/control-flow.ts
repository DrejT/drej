/**
 * Demonstrates all four control-flow step types:
 *   retry       — retries a flaky command up to N times with exponential backoff
 *   conditional — branches based on a state value (sandboxId present or not)
 *   loop        — writes one file per item; uses {{filename}} interpolation
 *   parallel    — runs two independent commands concurrently
 */
import { DrejClient } from "../packages/sdks/typescript/src/index";

const client = new DrejClient({ baseUrl: process.env.DREJ_API_URL ?? "http://localhost:6000" });
const workflowId = `control-flow-${Date.now()}`;

console.log(`Running workflow ${workflowId}...\n`);

for await (const ev of client.runWorkflow(workflowId, [
  // ── 1. Boot sandbox ────────────────────────────────────────────────────
  {
    type: "create_sandbox",
    image: { uri: "ubuntu:22.04" },
    entrypoint: ["tail", "-f", "/dev/null"],
    resourceLimits: { cpu: "500m", memory: "512Mi" },
  },

  // ── 2. retry ───────────────────────────────────────────────────────────
  // Coin flip: fails ~50% of the time. Retry handles it.
  {
    type: "retry",
    maxAttempts: 5,
    delayMs: 200,
    backoff: "exponential",
    step: {
      type: "exec_command",
      command: `
        R=$((RANDOM % 2))
        if [ $R -eq 0 ]; then
          echo "[retry] tails — failing"
          exit 1
        fi
        echo "[retry] heads — success after attempt"
      `,
    },
  },

  // ── 3. conditional ─────────────────────────────────────────────────────
  // sandboxId is in state after create_sandbox, so the "then" branch runs.
  {
    type: "conditional",
    condition: { op: "exists", field: "sandboxId" },
    then: [
      { type: "exec_command", command: 'echo "[conditional] then-branch: sandbox is alive"' },
    ],
    else: [
      { type: "exec_command", command: 'echo "[conditional] else-branch: no sandbox"' },
    ],
  },

  // ── 4. loop ────────────────────────────────────────────────────────────
  // Iterates over a static list. {{filename}} and {{loopIndex}} are injected
  // into each iteration's state and interpolated into the command string.
  {
    type: "loop",
    items: ["alpha.txt", "beta.txt", "gamma.txt"],
    as: "filename",
    steps: [
      {
        type: "exec_command",
        command: 'echo "[loop {{loopIndex}}] writing /tmp/{{filename}}" && echo "hello" > /tmp/{{filename}}',
      },
    ],
  },

  // ── 5. parallel ────────────────────────────────────────────────────────
  // Both branches sleep 1s and run concurrently — total wall time ~1s, not 2s.
  {
    type: "parallel",
    steps: [
      { type: "exec_command", command: 'sleep 1 && echo "[parallel 0] done"' },
      { type: "exec_command", command: 'sleep 1 && echo "[parallel 1] done"' },
    ],
  },

  // ── 6. verify loop results ─────────────────────────────────────────────
  { type: "exec_command", command: "ls /tmp/*.txt && echo '[verify] all files present'" },

  // ── 7. cleanup ─────────────────────────────────────────────────────────
  { type: "delete_sandbox" },
])) {
  if (ev.event === "exec_event") {
    const e = ev.payload as { type: string; text?: string };
    if (e.text) process.stdout.write(e.text);
  } else {
    const branch = ev.branch !== undefined ? ` branch=${ev.branch}` : "";
    const extra = ev.error ? ` error=${ev.error}` : "";
    console.log(`[${ev.event}] step=${ev.stepIndex}${branch}${extra}`);
  }
}
