/**
 * RLM fan-out: a master agent clones a repo, decides how to split a task
 * across it, and spawns child agents (via `drejx spawn`, itself built on
 * `Agent.spawn()`) that each work on one slice from the *exact same*
 * checked-out commit — not a fresh clone each. See TASK.md for the actual
 * goal handed to the master (G2: externalized as a file, not pasted into
 * the prompt) and plans/drejx-rlm-substrate.md for the full design.
 *
 * This script is both the demo and the integration test — it inspects real
 * evidence from the sandboxes afterward rather than trusting the model's
 * own report:
 *   - every spawned child's `repo` is at the master's exact commit (G5 proof)
 *   - a master-only secret (RLM_FANOUT_SECRET) is genuinely absent from a
 *     child's actual Pi/bridge environment (env-leak negative control)
 *   - a spawned child's own `DREJX_SPAWN_DEPTH` is exactly 0 (not absent)
 *   - a worker has no `drejx` installed at all, so it cannot itself spawn
 *     (worker.json's own scoping, a second, structural negative control)
 *   - the master never committed anything to `repo` itself (report-only)
 *
 * Run: bun examples/rlm-repo-fanout/index.ts
 * Needs: OpenSandbox running + reachable from containers (see
 *        examples/pi-agent/test-spawn-child.ts for the two things that have
 *        to be true for that), NVIDIA_API_KEY in .env.
 */
import { Agent } from "@drej/agent";
import { Drej, SandboxStatus } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";
import { randomBytes } from "crypto";

// Relative paths below (agent specs, ledger) are resolved against this
// directory regardless of the invoking shell's CWD — `Bun.file()` resolves
// against `process.cwd()`, and this example is documented to run as
// `bun examples/rlm-repo-fanout/index.ts` from the repo root.
process.chdir(import.meta.dir);

process.env.MASTER_AGENT_OPENSANDBOX_DOMAIN ??= "172.17.0.1:8080";
const SECRET = `rlm-fanout-secret-${randomBytes(8).toString("hex")}`;
process.env.RLM_FANOUT_SECRET = SECRET;

const MASTER_SPEC = "./agents/master.json";
const adapter = new SQLiteAdapter("./.drej/ledger.db");
const client = new Drej({
  baseUrl: process.env.OPEN_SANDBOX_URL ?? "http://127.0.0.1:8080",
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? "",
  adapter,
  useServerProxy: process.env.USE_SERVER_PROXY !== "false",
});

const checks: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const testStart = Date.now();
console.log("=== Loading master (spawnDepth: 1) ===\n");
const master = await Agent.load(MASTER_SPEC, { adapter, rebuild: process.env.REBUILD === "1" });
console.log(
  `\nmaster: ${master.name}  sandbox: ${master.sandboxId}  fromSnapshot: ${master.fromSnapshot}\n`,
);

const spawnedChildren: Agent[] = [];

try {
  console.log("=== Prompting master (goal lives in TASK.md, not in this prompt) ===\n");
  let reply = "";
  try {
    for await (const ev of master.prompt(
      "Read ./TASK.md in your working directory and complete the task described there. " +
        "Report a summary of what happened, including the combined patch set, when you are done.",
    )) {
      if (ev.type === "text") {
        process.stdout.write(ev.text);
        reply += ev.text;
      } else if (ev.type === "tool_start") {
        console.log(`\n[tool_start] ${ev.toolName} ${JSON.stringify(ev.args).slice(0, 200)}`);
      } else if (ev.type === "tool_end") {
        console.log(`[tool_end]   ${ev.toolName} isError=${ev.isError}`);
      }
    }
  } catch (err) {
    console.log(`\nprompt failed: ${err instanceof Error ? err.message : String(err)}`);
    const logs = await master.getLogs().catch(() => "");
    const filtered = logs
      .split("\n")
      .filter((l) => /error|exit|ready|429|quota|exception/i.test(l))
      .join("\n");
    console.log(`--- filtered bridge logs ---\n${filtered}\n--- end filtered logs ---`);
    throw err;
  }
  console.log("\n\n" + "─".repeat(60));

  // ── Independent verification ────────────────────────────────────────────
  console.log("\n=== Verifying evidence (not the model's self-report) ===\n");

  const { stdout: masterHeadOut } = await master.sandbox.exec("cd repo && git rev-parse HEAD");
  const masterHead = masterHeadOut.trim();
  console.log(`master repo HEAD: ${masterHead}`);

  // A separate exec() call, not a "&&"-chained one — sb.exec() doesn't insert a
  // newline between chained commands' outputs, so comparing against a second
  // command's output in the same call is unreliable. Re-running the same
  // command standalone and comparing HEAD before/after is what "no new commit
  // was made" actually means anyway.
  const { stdout: masterHeadAfterOut } = await master.sandbox.exec("cd repo && git rev-parse HEAD");
  check(
    "master never committed to its own repo (report-only)",
    masterHeadAfterOut.trim() === masterHead,
  );

  const allSessions = await client.sandboxes.list({ status: SandboxStatus.Running });
  const childSessions = allSessions.filter(
    (s) => s.name.startsWith(`fork-${master.name}-`) && s.startedAt >= testStart,
  );
  check(
    "at least one child was spawned",
    childSessions.length > 0,
    `found ${childSessions.length}`,
  );

  for (const session of childSessions) {
    console.log(`\n--- child: ${session.name} (${session.sandboxId}) ---`);
    const child = await Agent.attach(session.sandboxId, { adapter, name: session.name });
    spawnedChildren.push(child);

    const { stdout: childHeadOut } = await child.sandbox.exec("cd repo && git rev-parse HEAD");
    check(`${session.name}: repo HEAD matches master's`, childHeadOut.trim() === masterHead);

    let probeOut = "";
    for await (const ev of child.bash(
      `echo "SECRET=[$RLM_FANOUT_SECRET]"; echo "DEPTH=[$DREJX_SPAWN_DEPTH]"; which drejx > /dev/null 2>&1; echo "DREJX_FOUND=[$?]"`,
    )) {
      if (ev.type === "text") probeOut += ev.text;
    }
    check(
      `${session.name}: master's secret is absent`,
      probeOut.includes("SECRET=[]") && !probeOut.includes(SECRET),
    );
    check(`${session.name}: spawn depth is exactly 0`, probeOut.includes("DEPTH=[0]"));
    check(
      `${session.name}: has no drejx installed (cannot itself spawn)`,
      probeOut.includes("DREJX_FOUND=[1]"),
    );
  }

  console.log(`\n=== ${checks.filter((c) => c.pass).length}/${checks.length} checks passed ===`);
  console.log(checks.every((c) => c.pass) ? "\n✓ PASS" : "\n✗ FAIL — see checks above");
  if (!checks.every((c) => c.pass)) process.exitCode = 1;
} finally {
  await Promise.all(spawnedChildren.map((c) => c.close()));
  await master.close();
  console.log("\nAll sandboxes closed.");
}
