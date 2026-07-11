import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * Lets a Pi agent orchestrate other drejx-managed agent sessions as typed tool
 * calls, instead of hand-rolling `osb` commands through the bash tool. Wraps
 * exactly the CLI's "agent" command group (run/prompt/agents/kill) — session
 * lifecycle only, no SDK/registry management.
 *
 * Install into a sandbox via a spec's setup steps:
 *   npm install -g drejx
 *   mkdir -p .pi/extensions && cp "$(npm root -g)/drejx/pi-extension/drejx.ts" .pi/extensions/drejx.ts
 */
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "drejx_run",
    label: "Start a drejx agent session",
    description:
      "Starts a new agent sandbox from a spec, optionally sends it a first prompt, " +
      "and returns the reply. The session keeps running after this call returns — " +
      "use drejx_prompt to continue talking to it. The spec must already be a local " +
      "file path in this sandbox's agents dir (no URL fetching).",
    promptSnippet: "drejx_run — start a child agent sandbox from a local AgentSpec file",
    parameters: Type.Object({
      spec: Type.String({ description: "Local path to an AgentSpec JSON file" }),
      prompt: Type.Optional(Type.String({ description: "Optional first message to send" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const args = ["run", params.spec, "--json"];
      if (params.prompt) args.push("--prompt", params.prompt);
      const res = await pi.exec("drejx", args, { cwd: ctx.cwd, signal });
      if (res.code !== 0) throw new Error(res.stderr || `drejx run exited ${res.code}`);
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
        description: "Sandbox ID, as returned by drejx_run or drejx_agents",
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
    description: "Lists currently running agent sessions started by drejx_run.",
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
        description: "Sandbox ID, as returned by drejx_run or drejx_agents",
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const res = await pi.exec("drejx", ["kill", params.sandboxId], { cwd: ctx.cwd, signal });
      if (res.code !== 0) throw new Error(res.stderr || `drejx kill exited ${res.code}`);
      return { content: [{ type: "text", text: res.stdout }], details: {} };
    },
  });
}
