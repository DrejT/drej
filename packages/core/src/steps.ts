import { ControlClient, ExecClient } from "@drejt/opensandbox";
import type { SSEEvent } from "@drejt/opensandbox";
import { LedgerEvent } from "./ledger";
import type { WorkflowRunContext, WorkflowStep } from "./workflow";

// ── Step types ─────────────────────────────────────────────────────────────

export type Predicate =
  | { op: "eq" | "neq"; field: string; value: unknown }
  | { op: "gt" | "lt" | "gte" | "lte"; field: string; value: number }
  | { op: "exists" | "not_exists"; field: string }
  | { op: "and" | "or"; predicates: Predicate[] };

export type StepDef =
  | {
      type: "create_sandbox";
      image?: { uri: string; auth?: { username: string; password: string } };
      snapshotId?: string;
      timeout?: number;
      entrypoint?: string[];
      env?: Record<string, string>;
      metadata?: Record<string, string>;
      resourceLimits?: { cpu?: string; memory?: string; gpu?: string };
    }
  | { type: "exec_code"; code: string; context?: { id: string; language: string } }
  | { type: "exec_command"; command: string; cwd?: string; envs?: Record<string, string>; capture?: string }
  | { type: "delete_sandbox" }
  | { type: "write_file"; path: string; content: string; encoding?: "utf8" | "base64" }
  | { type: "read_file"; path: string; as: string; encoding?: "utf8" | "base64" }
  | { type: "snapshot" }
  | { type: "retry"; step: StepDef; maxAttempts: number; delayMs?: number; backoff?: "fixed" | "exponential" }
  | { type: "conditional"; condition: Predicate; then: StepDef[]; else?: StepDef[] }
  | { type: "loop"; over?: string; items?: unknown[]; as: string; steps: StepDef[]; concurrently?: boolean }
  | { type: "parallel"; steps: StepDef[] }
  | { type: "sequence"; steps: StepDef[] };

export type WorkflowState = Record<string, unknown> & { sandboxId?: string };

export interface SnapshotConfig {
  afterSteps?: number[];
  everyNSteps?: number;
}

// ── execd resolution ───────────────────────────────────────────────────────

// Resolves a ready ExecClient for the given sandbox.
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
      if (attempt === retries) throw new Error(`execd not ready after ${retries}s for sandbox ${sandboxId}`);
      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("unreachable");
}

// ── Snapshot helpers ───────────────────────────────────────────────────────

export function shouldSnapshot(config: SnapshotConfig, stepIndex: number): boolean {
  if (config.afterSteps?.includes(stepIndex)) return true;
  if (config.everyNSteps && (stepIndex + 1) % config.everyNSteps === 0) return true;
  return false;
}

export async function waitForSnapshot(
  control: ControlClient,
  snapshotId: string,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await control.getSnapshot(snapshotId);
    if (snap.state === "Ready") return;
    if (snap.state === "Failed") throw new Error(`Snapshot ${snapshotId} failed`);
    await new Promise<void>((r) => setTimeout(r, 2_000));
  }
  throw new Error(`Snapshot ${snapshotId} did not become ready within ${timeoutMs}ms`);
}

// ── Predicate evaluation ───────────────────────────────────────────────────

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

function interpolate(template: string, state: WorkflowState): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = state[key as keyof WorkflowState];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

function evaluate(predicate: Predicate, state: unknown): boolean {
  switch (predicate.op) {
    case "eq":  return getPath(state, predicate.field) === predicate.value;
    case "neq": return getPath(state, predicate.field) !== predicate.value;
    case "gt":  return Number(getPath(state, predicate.field)) > predicate.value;
    case "lt":  return Number(getPath(state, predicate.field)) < predicate.value;
    case "gte": return Number(getPath(state, predicate.field)) >= predicate.value;
    case "lte": return Number(getPath(state, predicate.field)) <= predicate.value;
    case "exists":     return getPath(state, predicate.field) !== undefined;
    case "not_exists": return getPath(state, predicate.field) === undefined;
    case "and": return predicate.predicates.every((p) => evaluate(p, state));
    case "or":  return predicate.predicates.some((p) => evaluate(p, state));
  }
}

// ── Step builder ───────────────────────────────────────────────────────────

export function buildStep(def: StepDef): WorkflowStep {
  switch (def.type) {
    case "create_sandbox":
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
            if (s.status.state === "Running") break;
            if (s.status.state === "Failed" || s.status.state === "Terminated") {
              throw new Error(`Sandbox ${sb.id} entered state ${s.status.state}: ${s.status.message ?? ""}`);
            }
            await new Promise<void>((r) => setTimeout(r, 1_000));
          }

          return { ...state, sandboxId: sb.id };
        },
        async rollback(output: unknown, ctx: WorkflowRunContext): Promise<void> {
          const state = output as WorkflowState;
          if (state.sandboxId) await ctx.control.deleteSandbox(state.sandboxId);
        },
      };

    case "exec_code":
      return {
        id: "exec_code",
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const state = (input ?? {}) as WorkflowState;
          if (!state.sandboxId) throw new Error("exec_code requires sandboxId in workflow state");
          const exec = await ctx.resolveExec(state.sandboxId);
          const events: SSEEvent[] = [];
          for await (const ev of exec.executeCode({ code: def.code, context: def.context })) {
            await ctx.emit({
              ts: Date.now(),
              workflowName: ctx.workflowName, runId: ctx.runId,
              stepIndex: ctx.stepIndex,
              event: LedgerEvent.ExecEvent,
              payload: ev,
            });
            events.push(ev as unknown as SSEEvent);
          }
          return { ...state, codeEvents: events };
        },
      };

    case "exec_command":
      return {
        id: "exec_command",
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const state = (input ?? {}) as WorkflowState;
          if (!state.sandboxId) throw new Error("exec_command requires sandboxId in workflow state");
          const exec = await ctx.resolveExec(state.sandboxId);
          const raw = interpolate(def.command, state);
          // base64-encode so newlines, quotes, special chars survive the JSON boundary
          const command = `echo ${Buffer.from(raw).toString("base64")} | base64 -d | bash`;
          const events: SSEEvent[] = [];
          let exitCode = 0;
          const stdoutChunks: string[] = [];
          for await (const ev of exec.executeCommand({ command, cwd: def.cwd, envs: def.envs })) {
            await ctx.emit({
              ts: Date.now(),
              workflowName: ctx.workflowName, runId: ctx.runId,
              stepIndex: ctx.stepIndex,
              event: LedgerEvent.ExecEvent,
              payload: ev,
            });
            events.push(ev as unknown as SSEEvent);
            if (ev.type === "error" && ev.error?.evalue !== undefined) {
              const code = Number(ev.error.evalue);
              if (!isNaN(code)) exitCode = code;
            }
            if (def.capture && ev.type === "stdout" && ev.text) {
              stdoutChunks.push(ev.text);
            }
          }
          const next: WorkflowState = { ...state, commandEvents: events, exitCode };
          if (def.capture) next[def.capture] = stdoutChunks.join("").trimEnd();
          return next;
        },
      };

    case "delete_sandbox":
      return {
        id: "delete_sandbox",
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const state = (input ?? {}) as WorkflowState;
          if (state.sandboxId) await ctx.control.deleteSandbox(state.sandboxId);
          return { ...state, sandboxId: undefined };
        },
      };

    case "write_file":
      return {
        id: "write_file",
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const state = (input ?? {}) as WorkflowState;
          if (!state.sandboxId) throw new Error("write_file requires sandboxId in workflow state");
          const exec = await ctx.resolveExec(state.sandboxId);
          const content: string | ArrayBuffer = def.encoding === "base64"
            ? Buffer.from(def.content, "base64").buffer as ArrayBuffer
            : def.content;
          await exec.uploadFile(def.path, content);
          return state;
        },
      };

    case "read_file":
      return {
        id: "read_file",
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const state = (input ?? {}) as WorkflowState;
          if (!state.sandboxId) throw new Error("read_file requires sandboxId in workflow state");
          const exec = await ctx.resolveExec(state.sandboxId);
          const stream = await exec.downloadFile(def.path);
          const chunks: Uint8Array[] = [];
          const reader = stream.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
          } finally {
            reader.releaseLock();
          }
          const bytes = Buffer.concat(chunks);
          const content = def.encoding === "base64" ? bytes.toString("base64") : bytes.toString("utf8");
          return { ...state, [def.as]: content };
        },
      };

    case "snapshot":
      return {
        id: "snapshot",
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const state = (input ?? {}) as WorkflowState;
          if (!state.sandboxId) throw new Error("snapshot requires sandboxId in workflow state");
          const snap = await ctx.control.createSnapshot(state.sandboxId);
          await waitForSnapshot(ctx.control, snap.id);
          await ctx.emit({
            ts: Date.now(),
            workflowName: ctx.workflowName,
            runId: ctx.runId,
            stepIndex: ctx.stepIndex,
            event: LedgerEvent.Snapshot,
            payload: { snapshotId: snap.id, sandboxId: state.sandboxId },
          });
          return { ...state, snapshotId: snap.id };
        },
      };

    case "retry": {
      const child = buildStep(def.step);
      return {
        id: "retry",
        rollback: child.rollback,
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          let lastErr: unknown;
          for (let attempt = 0; attempt < def.maxAttempts; attempt++) {
            try {
              return await child.run(input, ctx);
            } catch (err) {
              lastErr = err;
              if (attempt < def.maxAttempts - 1) {
                const base = def.delayMs ?? 500;
                const delay = def.backoff === "exponential" ? base * Math.pow(2, attempt) : base;
                await ctx.emit({
                  ts: Date.now(), workflowName: ctx.workflowName, runId: ctx.runId, stepIndex: ctx.stepIndex,
                  event: LedgerEvent.ExecEvent,
                  payload: { type: "retry_attempt", attempt: attempt + 1, maxAttempts: def.maxAttempts, error: String(err) },
                });
                await new Promise<void>((r) => setTimeout(r, delay));
              }
            }
          }
          throw lastErr;
        },
      };
    }

    case "conditional": {
      const thenSteps = def.then.map(buildStep);
      const elseSteps = (def.else ?? []).map(buildStep);
      return {
        id: "conditional",
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const branch = evaluate(def.condition, input) ? thenSteps : elseSteps;
          let current = input;
          for (const step of branch) {
            current = await step.run(current, ctx);
          }
          return current;
        },
      };
    }

    case "loop": {
      return {
        id: "loop",
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const arr = def.items ?? (def.over ? getPath(input, def.over) : undefined);
          if (!Array.isArray(arr)) throw new Error(`loop: must provide either "items" or "over" pointing to an array in workflow state`);

          const runIteration = async (item: unknown, index: number): Promise<unknown> => {
            const iterState = { ...(input as WorkflowState), [def.as]: item, loopIndex: index };
            let current: unknown = iterState;
            for (const step of def.steps.map(buildStep)) {
              current = await step.run(current, ctx);
            }
            return current;
          };

          const loopResults = def.concurrently
            ? await Promise.all(arr.map((item, i) => runIteration(item, i)))
            : await arr.reduce<Promise<unknown[]>>(async (accP, item, i) => {
                const acc = await accP;
                acc.push(await runIteration(item, i));
                return acc;
              }, Promise.resolve([]));

          return { ...(input as WorkflowState), loopResults };
        },
      };
    }

    case "parallel": {
      return {
        id: "parallel",
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const results = await Promise.all(
            def.steps.map((stepDef, branchIndex) => {
              const branchCtx: WorkflowRunContext = {
                ...ctx,
                stepIndex: ctx.stepIndex * 1000 + branchIndex,
                emit: (entry) => ctx.emit({ ...entry, branch: branchIndex }),
              };
              return buildStep(stepDef).run(input, branchCtx);
            }),
          );

          const merged = results.reduce<WorkflowState>(
            (acc, result) => ({ ...acc, ...(result as WorkflowState) }),
            input as WorkflowState,
          );

          return { ...merged, parallelResults: results };
        },
      };
    }

    case "sequence": {
      const childSteps = def.steps.map(buildStep);
      return {
        id: "sequence",
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          let current = input;
          for (const step of childSteps) {
            current = await step.run(current, ctx);
          }
          return current;
        },
        async rollback(input: unknown, ctx: WorkflowRunContext): Promise<void> {
          for (const step of [...childSteps].reverse()) {
            if (step.rollback) await step.rollback(input, ctx);
          }
        },
      };
    }
  }
}
