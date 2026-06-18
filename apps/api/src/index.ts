import { Elysia, t } from "elysia";
import { ControlClient, ExecClient, OpenSandboxError } from "@drej/opensandbox";
import type { SSEEvent } from "@drej/opensandbox";
import {
  Workflow,
  NdjsonLedger,
  LedgerEvent,
  ConsoleLogger,
  LogLevel,
  type WorkflowDeps,
  type WorkflowStep,
  type WorkflowRunContext,
  type ILedger,
  type ISandboxControl,
  type ISandboxExec,
} from "@drej/core";

const BASE_URL = process.env.OPEN_SANDBOX_BASE_URL ?? "http://localhost:8080";
const API_KEY = process.env.OPEN_SANDBOX_API_KEY!;
const PORT = Number(process.env.PORT ?? 6000);
const LEDGER_DIR = process.env.LEDGER_DIR ?? "./ledgers";

function parseLogLevel(s?: string): LogLevel {
  switch (s?.toLowerCase()) {
    case "debug": return LogLevel.Debug;
    case "warn": return LogLevel.Warn;
    case "error": return LogLevel.Error;
    case "silent": return LogLevel.Silent;
    default: return LogLevel.Info;
  }
}

const logger = new ConsoleLogger(parseLogLevel(process.env.LOG_LEVEL));

const control = new ControlClient({ baseUrl: BASE_URL, apiKey: API_KEY });

async function resolveExecClient(sandboxId: string, retries = 15, delayMs = 1_000): Promise<ExecClient> {
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

// ── Microkernel adapter wiring ─────────────────────────────────────────────
// Bridge @drej/opensandbox concrete drivers → @drej/core port interfaces.
// The cast is intentional: both types are structurally identical (derived from
// the same OpenSandbox API spec) but live in separate packages.

const workflowDeps: WorkflowDeps = {
  control: control as unknown as ISandboxControl,
  execFactory: {
    forSandbox: async (sandboxId: string): Promise<ISandboxExec> => {
      const exec = await resolveExecClient(sandboxId);
      return exec as unknown as ISandboxExec;
    },
  },
  ledger: new NdjsonLedger(LEDGER_DIR),
  logger,
};

// ── Workflow step definitions ──────────────────────────────────────────────

enum StepType {
  CreateSandbox = "create_sandbox",
  ExecCode = "exec_code",
  ExecCommand = "exec_command",
  DeleteSandbox = "delete_sandbox",
}

type StepDef =
  | {
      type: StepType.CreateSandbox;
      image?: { uri: string; auth?: { username: string; password: string } };
      snapshotId?: string;
      timeout?: number;
      entrypoint?: string[];
      env?: Record<string, string>;
      metadata?: Record<string, string>;
      resourceLimits?: { cpu?: string; memory?: string; gpu?: string };
    }
  | { type: StepType.ExecCode; code: string; context?: { id: string; language: string } }
  | { type: StepType.ExecCommand; command: string; cwd?: string; envs?: Record<string, string> }
  | { type: StepType.DeleteSandbox };

type WorkflowState = Record<string, unknown> & { sandboxId?: string };

function buildStep(def: StepDef): WorkflowStep {
  switch (def.type) {
    case StepType.CreateSandbox:
      return {
        id: StepType.CreateSandbox,
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

          // Poll until Running before handing sandboxId to the next step
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

    case StepType.ExecCode:
      return {
        id: StepType.ExecCode,
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const state = (input ?? {}) as WorkflowState;
          if (!state.sandboxId) throw new Error("exec_code requires sandboxId in workflow state");
          const exec = await ctx.execFactory.forSandbox(state.sandboxId);
          const events: SSEEvent[] = [];
          for await (const ev of exec.executeCode({ code: def.code, context: def.context })) {
            await ctx.emit({
              ts: Date.now(),
              workflowId: ctx.workflowId,
              stepIndex: ctx.stepIndex,
              event: LedgerEvent.ExecEvent,
              payload: ev,
            });
            events.push(ev as unknown as SSEEvent);
          }
          return { ...state, codeEvents: events };
        },
      };

    case StepType.ExecCommand:
      return {
        id: StepType.ExecCommand,
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const state = (input ?? {}) as WorkflowState;
          if (!state.sandboxId) throw new Error("exec_command requires sandboxId in workflow state");
          const exec = await ctx.execFactory.forSandbox(state.sandboxId);
          const events: SSEEvent[] = [];
          for await (const ev of exec.executeCommand({ command: def.command, cwd: def.cwd, envs: def.envs })) {
            await ctx.emit({
              ts: Date.now(),
              workflowId: ctx.workflowId,
              stepIndex: ctx.stepIndex,
              event: LedgerEvent.ExecEvent,
              payload: ev,
            });
            events.push(ev as unknown as SSEEvent);
          }
          return { ...state, commandEvents: events };
        },
      };

    case StepType.DeleteSandbox:
      return {
        id: StepType.DeleteSandbox,
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const state = (input ?? {}) as WorkflowState;
          if (state.sandboxId) await ctx.control.deleteSandbox(state.sandboxId);
          return { ...state, sandboxId: undefined };
        },
      };
  }
}

// ── SSE helpers ────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function sseResponse(gen: AsyncGenerator<SSEEvent>): Response {
  return new Response(
    new ReadableStream({
      async start(ctrl) {
        try {
          for await (const event of gen) {
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
        } catch (err) {
          const errEvent = { type: "error", error: { message: String(err) }, timestamp: Date.now() };
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(errEvent)}\n\n`));
        } finally {
          ctrl.close();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    },
  );
}

// Tee ledger: persists to NdjsonLedger AND streams each entry to the SSE client.
// exec_event entries flow through here in real-time as code/commands execute.
function workflowSseResponse(
  workflowId: string,
  steps: WorkflowStep[],
  deps: WorkflowDeps,
  resumeMode: boolean,
): Response {
  return new Response(
    new ReadableStream({
      async start(ctrl) {
        const emit = (line: unknown) =>
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(line)}\n\n`));

        const teeLedger: ILedger = {
          async append(entry) {
            await deps.ledger.append(entry);
            emit(entry);
          },
          readAll: (wfId) => deps.ledger.readAll(wfId),
          lastCheckpoint: (wfId) => deps.ledger.lastCheckpoint(wfId),
        };

        const teeDeps: WorkflowDeps = { ...deps, ledger: teeLedger };

        let workflow: Workflow | undefined;
        try {
          let nextStep: number;
          let lastOutput: unknown;

          if (resumeMode) {
            ({ workflow, nextStep, lastOutput } = await Workflow.resumeFromLedger(
              workflowId,
              steps,
              teeDeps,
            ));
          } else {
            workflow = new Workflow(workflowId, steps, teeDeps);
            nextStep = 0;
            lastOutput = {};
          }

          await workflow.run(lastOutput, nextStep);
        } catch (err) {
          // Saga rollback: clean up any completed steps (e.g. delete sandbox on failure)
          try { await workflow?.rollback(); } catch { /* ignore rollback errors */ }
          emit({ event: "workflow_failed", workflowId, error: String(err), ts: Date.now(), stepIndex: -1 });
        } finally {
          ctrl.close();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    },
  );
}

// ── Elysia schemas ─────────────────────────────────────────────────────────

const ImageSpecSchema = t.Object({
  uri: t.String(),
  auth: t.Optional(t.Object({ username: t.String(), password: t.String() })),
});

const ResourcesSchema = t.Object({
  cpu: t.Optional(t.String()),
  memory: t.Optional(t.String()),
  gpu: t.Optional(t.String()),
});

const StepSchema = t.Object({
  type: t.Union([
    t.Literal(StepType.CreateSandbox),
    t.Literal(StepType.ExecCode),
    t.Literal(StepType.ExecCommand),
    t.Literal(StepType.DeleteSandbox),
  ]),
  // create_sandbox
  image: t.Optional(ImageSpecSchema),
  snapshotId: t.Optional(t.String()),
  timeout: t.Optional(t.Number()),
  entrypoint: t.Optional(t.Array(t.String())),
  env: t.Optional(t.Record(t.String(), t.String())),
  metadata: t.Optional(t.Record(t.String(), t.String())),
  // exec_code
  code: t.Optional(t.String()),
  context: t.Optional(t.Object({ id: t.String(), language: t.String() })),
  // exec_command
  command: t.Optional(t.String()),
  cwd: t.Optional(t.String()),
  envs: t.Optional(t.Record(t.String(), t.String())),
  // create_sandbox resource limits
  resourceLimits: t.Optional(ResourcesSchema),
});

// ── App ────────────────────────────────────────────────────────────────────

const app = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof OpenSandboxError) {
      set.status = error.status;
      return { error: error.message };
    }
    set.status = 500;
    return { error: error instanceof Error ? error.message : String(error) };
  })

  // Health
  .get("/health", () => ({ healthy: true }))

  // ── Sandbox lifecycle ──────────────────────────────────────────────────────

  .post(
    "/v1/sandboxes",
    ({ body }) => control.createSandbox(body),
    {
      body: t.Object({
        image: t.Optional(ImageSpecSchema),
        snapshotId: t.Optional(t.String()),
        timeout: t.Optional(t.Number()),
        resourceLimits: t.Optional(ResourcesSchema),
        entrypoint: t.Optional(t.Array(t.String())),
        env: t.Optional(t.Record(t.String(), t.String())),
        metadata: t.Optional(t.Record(t.String(), t.String())),
        secureAccess: t.Optional(t.Boolean()),
      }),
    },
  )
  .get(
    "/v1/sandboxes",
    ({ query }) =>
      control.listSandboxes({
        state: query.state as import("@drej/opensandbox").SandboxState | undefined,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      }),
    {
      query: t.Object({
        state: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )
  .get("/v1/sandboxes/:id", ({ params }) => control.getSandbox(params.id))
  .delete("/v1/sandboxes/:id", ({ params }) => control.deleteSandbox(params.id))
  .post("/v1/sandboxes/:id/pause", ({ params }) => control.pauseSandbox(params.id))
  .post("/v1/sandboxes/:id/resume", ({ params }) => control.resumeSandbox(params.id))
  .post("/v1/sandboxes/:id/renew", ({ params }) => control.renewExpiration(params.id))

  // ── Snapshots ──────────────────────────────────────────────────────────────

  .post("/v1/sandboxes/:id/snapshots", ({ params }) => control.createSnapshot(params.id))
  .get(
    "/v1/snapshots",
    ({ query }) =>
      control.listSnapshots({
        sandboxId: query.sandboxId,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      }),
    {
      query: t.Object({
        sandboxId: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )
  .get("/v1/snapshots/:id", ({ params }) => control.getSnapshot(params.id))
  .delete("/v1/snapshots/:id", ({ params }) => control.deleteSnapshot(params.id))

  // ── Diagnostics ────────────────────────────────────────────────────────────

  .get("/v1/sandboxes/:id/diagnostics/logs", ({ params }) =>
    control.getDiagnosticLogs(params.id),
  )
  .get("/v1/sandboxes/:id/diagnostics/events", ({ params }) =>
    control.getDiagnosticEvents(params.id),
  )

  // ── Code execution ─────────────────────────────────────────────────────────

  .post(
    "/v1/sandboxes/:id/exec/code",
    async ({ params, body }) => {
      const exec = await resolveExecClient(params.id);
      return sseResponse(exec.executeCode(body));
    },
    {
      body: t.Object({
        code: t.String(),
        context: t.Optional(t.Object({ id: t.String(), language: t.String() })),
      }),
    },
  )
  .delete("/v1/sandboxes/:id/exec/code", async ({ params }) => {
    const exec = await resolveExecClient(params.id);
    return exec.interruptCode();
  })

  // ── Code contexts ──────────────────────────────────────────────────────────

  .get(
    "/v1/sandboxes/:id/exec/contexts",
    async ({ params, query }) => {
      const exec = await resolveExecClient(params.id);
      return exec.listContexts(query.language);
    },
    { query: t.Object({ language: t.Optional(t.String()) }) },
  )
  .post(
    "/v1/sandboxes/:id/exec/contexts",
    async ({ params, body }) => {
      const exec = await resolveExecClient(params.id);
      return exec.createContext(body.language);
    },
    { body: t.Object({ language: t.String() }) },
  )
  .delete(
    "/v1/sandboxes/:id/exec/contexts",
    async ({ params, query }) => {
      const exec = await resolveExecClient(params.id);
      return exec.clearContexts(query.language);
    },
    { query: t.Object({ language: t.Optional(t.String()) }) },
  )
  .delete("/v1/sandboxes/:id/exec/contexts/:ctxId", async ({ params }) => {
    const exec = await resolveExecClient(params.id);
    return exec.deleteContext(params.ctxId);
  })

  // ── Command execution ──────────────────────────────────────────────────────

  .post(
    "/v1/sandboxes/:id/exec/command",
    async ({ params, body }) => {
      const exec = await resolveExecClient(params.id);
      return sseResponse(exec.executeCommand(body));
    },
    {
      body: t.Object({
        command: t.String(),
        cwd: t.Optional(t.String()),
        background: t.Optional(t.Boolean()),
        timeout: t.Optional(t.Number()),
        uid: t.Optional(t.Number()),
        gid: t.Optional(t.Number()),
        envs: t.Optional(t.Record(t.String(), t.String())),
      }),
    },
  )
  .delete("/v1/sandboxes/:id/exec/command", async ({ params }) => {
    const exec = await resolveExecClient(params.id);
    return exec.interruptCommand();
  })
  .get("/v1/sandboxes/:id/exec/command/status/:session", async ({ params }) => {
    const exec = await resolveExecClient(params.id);
    return exec.getCommandStatus(params.session);
  })
  .get("/v1/sandboxes/:id/exec/command/output/:session", async ({ params }) => {
    const exec = await resolveExecClient(params.id);
    return exec.getCommandOutput(params.session);
  })

  // ── Files ──────────────────────────────────────────────────────────────────

  .get(
    "/v1/sandboxes/:id/files/info",
    async ({ params, query }) => {
      const exec = await resolveExecClient(params.id);
      return exec.getFileInfo(query.path);
    },
    { query: t.Object({ path: t.String() }) },
  )
  .delete(
    "/v1/sandboxes/:id/files",
    async ({ params, query }) => {
      const exec = await resolveExecClient(params.id);
      return exec.deleteFile(query.path);
    },
    { query: t.Object({ path: t.String() }) },
  )
  .post(
    "/v1/sandboxes/:id/files/permissions",
    async ({ params, body }) => {
      const exec = await resolveExecClient(params.id);
      return exec.setPermissions(body.path, body.mode);
    },
    { body: t.Object({ path: t.String(), mode: t.String() }) },
  )
  .post(
    "/v1/sandboxes/:id/files/move",
    async ({ params, body }) => {
      const exec = await resolveExecClient(params.id);
      return exec.moveFile(body.from, body.to);
    },
    { body: t.Object({ from: t.String(), to: t.String() }) },
  )
  .get(
    "/v1/sandboxes/:id/files/search",
    async ({ params, query }) => {
      const exec = await resolveExecClient(params.id);
      return exec.searchFiles(query.pattern, query.dir);
    },
    { query: t.Object({ pattern: t.String(), dir: t.Optional(t.String()) }) },
  )
  .post(
    "/v1/sandboxes/:id/files/replace",
    async ({ params, body }) => {
      const exec = await resolveExecClient(params.id);
      return exec.replaceInFiles(body.replacements);
    },
    {
      body: t.Object({
        replacements: t.Array(
          t.Object({ path: t.String(), old: t.String(), new: t.String() }),
        ),
      }),
    },
  )
  .post(
    "/v1/sandboxes/:id/files/upload",
    async ({ params, body }) => {
      const exec = await resolveExecClient(params.id);
      await exec.uploadFile(body.path, body.file);
      return { ok: true };
    },
    { body: t.Object({ file: t.File(), path: t.String() }) },
  )
  .get(
    "/v1/sandboxes/:id/files/download",
    async ({ params, query }) => {
      const exec = await resolveExecClient(params.id);
      const stream = await exec.downloadFile(query.path);
      return new Response(stream, { headers: { "Content-Type": "application/octet-stream" } });
    },
    { query: t.Object({ path: t.String() }) },
  )

  // ── Directories ────────────────────────────────────────────────────────────

  .get(
    "/v1/sandboxes/:id/directories",
    async ({ params, query }) => {
      const exec = await resolveExecClient(params.id);
      return exec.listDirectory(query.path, query.depth ? Number(query.depth) : undefined);
    },
    { query: t.Object({ path: t.String(), depth: t.Optional(t.String()) }) },
  )
  .post(
    "/v1/sandboxes/:id/directories",
    async ({ params, body }) => {
      const exec = await resolveExecClient(params.id);
      return exec.createDirectory(body.path);
    },
    { body: t.Object({ path: t.String() }) },
  )
  .delete(
    "/v1/sandboxes/:id/directories",
    async ({ params, query }) => {
      const exec = await resolveExecClient(params.id);
      return exec.deleteDirectory(query.path);
    },
    { query: t.Object({ path: t.String() }) },
  )

  // ── Metrics ────────────────────────────────────────────────────────────────

  .get("/v1/sandboxes/:id/metrics", async ({ params }) => {
    const exec = await resolveExecClient(params.id);
    return exec.getMetrics();
  })
  .get("/v1/sandboxes/:id/metrics/watch", async ({ params }) => {
    const exec = await resolveExecClient(params.id);
    return sseResponse(exec.watchMetrics());
  })

  // ── Workflows (microkernel engine) ─────────────────────────────────────────

  .post(
    "/v1/workflows",
    ({ body }) => {
      const steps = (body.steps as unknown as StepDef[]).map(buildStep);
      return workflowSseResponse(body.id, steps, workflowDeps, false);
    },
    {
      body: t.Object({
        id: t.String(),
        steps: t.Array(StepSchema),
      }),
    },
  )
  .post(
    "/v1/workflows/:id/resume",
    ({ params, body }) => {
      const steps = (body.steps as unknown as StepDef[]).map(buildStep);
      return workflowSseResponse(params.id, steps, workflowDeps, true);
    },
    {
      body: t.Object({
        steps: t.Array(StepSchema),
      }),
    },
  )
  .get("/v1/workflows/:id/ledger", ({ params }) =>
    workflowDeps.ledger.readAll(params.id),
  )

  .listen(PORT);

console.log(`drej API running at ${app.server?.hostname}:${app.server?.port}`);
