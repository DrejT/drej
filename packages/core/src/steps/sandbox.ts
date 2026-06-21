import { ControlClient, ExecClient, SandboxState } from "@drej/opensandbox";
import { SandboxError, ExecConnectionError } from "../errors";
import type { WorkflowRunContext, WorkflowStep } from "../workflow";
import type { StepDef, WorkflowState } from "./types";

// Calls getEndpoint once (each call returns a different ephemeral proxy port)
// then polls listContexts until execd accepts connections.
export async function resolveExecClient(
  control: ControlClient,
  sandboxId: string,
  retries = 15,
  delayMs = 1_000,
): Promise<ExecClient> {
  const ep = await control.getEndpoint(sandboxId, 44772);
  const baseUrl = ep.endpoint.startsWith("http") ? ep.endpoint : `http://${ep.endpoint}`;
  const token = ep.headers?.["X-EXECD-ACCESS-TOKEN"] ?? "";
  const client = new ExecClient({ baseUrl, accessToken: token });
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await client.listContexts();
      return client;
    } catch {
      if (attempt === retries) throw new ExecConnectionError(sandboxId);
      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("unreachable");
}

export function buildCreateSandboxStep(def: Extract<StepDef, { type: "create_sandbox" }>): WorkflowStep {
  return {
    id: "create_sandbox",
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      const sb = await ctx.control.createSandbox({
        image: def.image,
        snapshotId: def.snapshotId,
        timeout: def.timeout,
        entrypoint: def.entrypoint,
        env: def.env,
        metadata: def.metadata,
        resourceLimits: def.resourceLimits,
      });

      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const s = await ctx.control.getSandbox(sb.id);
        if (s.status.state === SandboxState.Running) break;
        if (s.status.state === SandboxState.Failed || s.status.state === SandboxState.Terminated) {
          throw new SandboxError(
            `Sandbox entered state ${s.status.state}: ${s.status.message ?? ""}`,
            sb.id,
          );
        }
        await new Promise<void>((r) => setTimeout(r, 1_000));
      }
      if ((await ctx.control.getSandbox(sb.id)).status.state !== SandboxState.Running) {
        throw new SandboxError(`Sandbox timed out waiting to reach Running state`, sb.id);
      }

      return { ...state, sandboxId: sb.id };
    },
  };
}

export function buildDeleteSandboxStep(): WorkflowStep {
  return {
    id: "delete_sandbox",
    async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
      const state = (input ?? {}) as WorkflowState;
      if (state.sandboxId) await ctx.control.deleteSandbox(state.sandboxId);
      return { ...state, sandboxId: undefined };
    },
  };
}
