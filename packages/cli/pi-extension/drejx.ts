import type { ExtensionAPI, ExtensionContext, ExecResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * Lets a Pi agent manage other drejx-managed agent sessions as typed tool
 * calls, instead of hand-rolling shell commands through the bash tool. Wraps
 * exactly the CLI's session-lifecycle primitives (spawn/prompt/agents/kill) —
 * simple, structural operations with little ambiguity in their arguments.
 *
 * Deliberately does NOT wrap `drejx fork` (forking a running session's own
 * live sandbox into a child, the core RLM fan-out primitive) as a typed tool.
 * That decision belongs to the model's own reasoning about how to decompose
 * a task, expressed as an actual shell command it writes and runs via its
 * bash tool — not a verbal decision to call a fixed-shape registered tool.
 *
 * Install on a host machine (recommended — makes this available in every Pi
 * session afterward, not just one project):
 *   pi install npm:drejx
 *
 * `packages/cli/package.json`'s `"pi": { "extensions": [...] }` field is what
 * makes that resolve to this file (see `resolveExtensionEntries()` in Pi's
 * own `package-manager.js`).
 *
 * Install into a single sandbox via a spec's setup steps instead (what
 * `examples/rlm-repo-fanout` does today, project-scoped):
 *   npm install -g drejx
 *   mkdir -p .pi/extensions && cp "$(npm root -g)/drejx/pi-extension/drejx.ts" .pi/extensions/drejx.ts
 */
export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    await ensureDrejxReady(pi, ctx);
  });

  // `DREJ_SANDBOX_ID` is only set inside a sandbox created by an agent-creation
  // path (Agent.load()/resume()/spawn(), see packages/agent/src/agent.ts) — its
  // presence here means THIS Pi process is itself running inside one, so it has
  // live state (installed packages, a checked-out repo, files on disk) worth
  // forking into children via `drejx fork`. A host-level session (a user's own
  // local Pi, no sandbox of its own) has nothing to fork — only `drejx spawn`
  // (start a fresh, independent agent) makes sense there.
  const canFork = Boolean(process.env.DREJ_SANDBOX_ID);

  // Mechanical CLI guidance (above) is safe to inject unconditionally — it's
  // just "here's the syntax," true for any session. The RLM *mindset* prompt
  // below is opt-in: a one-off coding session shouldn't be told "you are an
  // orchestrator" unconditionally, only a spec deliberately built to act as
  // one. Gated on DREJX_RLM_MASTER (set in that spec's own `env`), with
  // DREJX_RLM_SYSTEM_PROMPT as a full override for specs that want their own
  // wording instead of the default — same ${VAR}-interpolation pattern every
  // other agent-spec env value already uses (see
  // examples/rlm-repo-fanout/agents/master.json's RLM_FANOUT_SECRET/
  // MASTER_AGENT_OPENSANDBOX_DOMAIN for the existing precedent).
  const rlmMindset = process.env.DREJX_RLM_SYSTEM_PROMPT
    ? `\n\n${process.env.DREJX_RLM_SYSTEM_PROMPT}`
    : process.env.DREJX_RLM_MASTER
      ? DEFAULT_RLM_MINDSET
      : "";

  pi.on("before_agent_start", (event) => ({
    systemPrompt: event.systemPrompt + (canFork ? FORK_GUIDANCE : SPAWN_ONLY_GUIDANCE) + rlmMindset,
  }));

  pi.registerTool({
    name: "drejx_spawn",
    label: "Start a drejx agent session",
    description:
      "Starts a new, independent agent sandbox from a spec, optionally sends it a first " +
      "prompt, and returns the reply. The session keeps running after this call returns — " +
      "use drejx_prompt to continue talking to it. The spec must already be a local " +
      "file path in this sandbox's agents dir (no URL fetching).",
    promptSnippet: "drejx_spawn — start a fresh agent sandbox from a local AgentSpec file",
    parameters: Type.Object({
      spec: Type.String({ description: "Local path to an AgentSpec JSON file" }),
      prompt: Type.Optional(Type.String({ description: "Optional first message to send" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const args = ["spawn", params.spec, "--json"];
      if (params.prompt) args.push("--prompt", params.prompt);
      const res = await pi.exec("drejx", args, { cwd: ctx.cwd, signal });
      if (res.code !== 0) throw new Error(res.stderr || `drejx spawn exited ${res.code}`);
      return { content: [{ type: "text", text: res.stdout }], details: { raw: res.stdout } };
    },
  });

  pi.registerTool({
    name: "drejx_prompt",
    label: "Message a running drejx sandbox",
    description: "Sends one message to an already-running agent sandbox and returns its reply.",
    promptSnippet: "drejx_prompt — send a message to a running child agent sandbox",
    parameters: Type.Object({
      sandboxId: Type.String({
        description: "Sandbox ID, as returned by drejx_spawn or drejx_agents",
      }),
      message: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const res = await pi.exec("drejx", ["prompt", params.sandboxId, params.message], {
        cwd: ctx.cwd,
        signal,
      });
      if (res.code !== 0) throw new Error(res.stderr || `drejx prompt exited ${res.code}`);
      return { content: [{ type: "text", text: res.stdout }], details: {} };
    },
  });

  pi.registerTool({
    name: "drejx_agents",
    label: "List drejx sessions",
    description: "Lists currently running agent sessions started by drejx_spawn.",
    promptSnippet: "drejx_agents — list running child agent sessions",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      const res = await pi.exec("drejx", ["agents", "--json"], { cwd: ctx.cwd, signal });
      if (res.code !== 0) throw new Error(res.stderr || `drejx agents exited ${res.code}`);
      return { content: [{ type: "text", text: res.stdout }], details: {} };
    },
  });

  pi.registerTool({
    name: "drejx_kill",
    label: "Stop a drejx sandbox",
    description: "Stops a running agent sandbox.",
    promptSnippet: "drejx_kill — stop a running child agent sandbox",
    parameters: Type.Object({
      sandboxId: Type.String({
        description: "Sandbox ID, as returned by drejx_spawn or drejx_agents",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const res = await pi.exec("drejx", ["kill", params.sandboxId], { cwd: ctx.cwd, signal });
      if (res.code !== 0) throw new Error(res.stderr || `drejx kill exited ${res.code}`);
      return { content: [{ type: "text", text: res.stdout }], details: {} };
    },
  });
}

const FORK_GUIDANCE = `

## Orchestrating sub-agents with drejx

You have the \`drejx\` CLI available. Your own session is running inside a
drej-managed sandbox, so you can fork YOUR OWN live filesystem state
(installed packages, a checked-out repo, any files already on disk) into
independent child agents:

    drejx fork <your-session-name> <child-spec.json> --prompt "<plain-English instruction>" --json

Each forked child starts from your exact current state, not a fresh clone —
use this when children need to see something you've already set up. Run this
as an actual shell command via your bash tool, not by describing it — you
decide how many children to fork and how to split the work; nothing scripts
that decision for you. Add \`--depth N\` / \`--max N\` to override a spec's own
nesting-depth or total-descendant budget if it has one.

To start a completely independent agent instead (no shared state needed):
\`drejx spawn <spec.json> --prompt "<msg>" --json\`. Other commands:
\`drejx agents [--json]\` (list running sessions), \`drejx prompt <sandbox-id>
<msg>\` (continue talking to one), \`drejx kill <sandbox-id>\` (stop one).

Only reach for forking when a task genuinely splits into independent pieces
of real size — for something you can finish yourself in a few tool calls,
just do it directly.`;

const SPAWN_ONLY_GUIDANCE = `

## Starting sub-agents with drejx

You have the \`drejx\` CLI available to start independent agent sessions in
their own sandboxes:

    drejx spawn <spec.json> --prompt "<msg>" --json

Other commands: \`drejx agents [--json]\` (list running sessions), \`drejx
prompt <sandbox-id> <msg>\` (continue talking to one), \`drejx kill
<sandbox-id>\` (stop one). A spawned agent running inside its own sandbox may
itself be able to fork further sub-agents from its own live state via
\`drejx fork\` — that's its own decision to make, not yours to script for it.`;

const DEFAULT_RLM_MINDSET = `

## Your role: RLM orchestrator

Think in terms of decompose, delegate, and collect. When a task is large
enough to genuinely split into independent pieces, prefer forking dedicated
sub-agents over doing everything yourself in one long session — each
sub-agent should get a clear, bounded slice of the work and report back a
concise result, not its full transcript. Keep your own context focused on
decomposition and integration, not on redoing what a child already did. For
small or genuinely atomic tasks, just do the work yourself — decomposition
should reflect the task's real shape, not be forced on something that
doesn't need it.`;

// Runs once per extension load, not once per `session_start` — that event
// also fires on reload/new/resume/fork, and `drejx init` (while itself
// idempotent) has a few seconds of Docker-state-check overhead not worth
// repeating every time. Reset on failure so a later session_start can retry
// instead of a transient failure (no network, Docker not running yet)
// permanently wedging bootstrap for the rest of the process.
let bootstrapped = false;

async function execOk(
  pi: ExtensionAPI,
  command: string,
  args: string[],
): Promise<ExecResult | null> {
  try {
    return await pi.exec(command, args);
  } catch {
    return null;
  }
}

/**
 * Ensures `drejx` is installed and OpenSandbox is reachable, so the user
 * never has to run either setup step themselves — this extension is meant
 * to be the entire distribution/setup path. `drejx init` already no-ops
 * cleanly when OpenSandbox is already running (see `packages/cli/src/commands/init.ts`),
 * so it's safe to call unconditionally rather than trying to detect
 * reachability here first.
 */
async function ensureDrejxReady(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  const check = await execOk(pi, "drejx", ["--version"]);
  if (!check || check.code !== 0) {
    ctx.ui.notify("Installing drejx...", "info");
    const install = await execOk(pi, "npm", ["install", "-g", "drejx"]);
    if (!install || install.code !== 0) {
      ctx.ui.notify(
        `Failed to install drejx: ${install?.stderr || "npm not available"}. ` +
          `RLM flows won't work until this is resolved — install manually with "npm install -g drejx".`,
        "error",
      );
      bootstrapped = false;
      return;
    }
  }

  const init = await execOk(pi, "drejx", ["init"]);
  if (!init || init.code !== 0) {
    ctx.ui.notify(
      `"drejx init" failed: ${init?.stderr || "unknown error"}. ` +
        `RLM flows won't work until OpenSandbox is reachable — see "drejx init" for manual setup.`,
      "warning",
    );
    bootstrapped = false;
  }
}
