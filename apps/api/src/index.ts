import { Elysia, t } from "elysia";
import { ControlClient, ExecClient, OpenSandboxError } from "@drej/opensandbox";
import type { SSEEvent } from "@drej/opensandbox";
import {
  Workflow,
  NdjsonLedger,
  LedgerEvent,
  ConsoleLogger,
  LogLevel,
  buildStep,
  resolveExecClient,
  shouldSnapshot,
  waitForSnapshot,
  type WorkflowDeps,
  type WorkflowStep,
  type ILedger,
  type StepDef,
  type SnapshotConfig,
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

const workflowDeps: WorkflowDeps = {
  control,
  resolveExec: (sandboxId) => resolveExecClient(control, sandboxId),
  ledger: new NdjsonLedger(LEDGER_DIR),
  logger,
};

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

function workflowSseResponse(
  workflowName: string,
  runId: string,
  steps: WorkflowStep[],
  deps: WorkflowDeps,
  resumeMode: boolean,
  snapshotConfig?: SnapshotConfig,
): Response {
  return new Response(
    new ReadableStream({
      async start(ctrl) {
        const emit = (line: unknown) =>
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(line)}\n\n`));

        const teeLedger: ILedger = {
          async append(entry) {
            await deps.ledger.append(entry);
            try { emit(entry); } catch { /* client disconnected — disk write already succeeded */ }
          },
          readAll: (name, id) => deps.ledger.readAll(name, id),
          lastCheckpoint: (name, id) => deps.ledger.lastCheckpoint(name, id),
          listRuns: (name) => deps.ledger.listRuns(name),
        };

        const snapshotHook: WorkflowDeps["hooks"] = snapshotConfig
          ? {
              async onStepComplete({ workflowName: wfName, runId: rid, stepIndex, output }) {
                if (!shouldSnapshot(snapshotConfig, stepIndex)) return;
                const sandboxId = (output as Record<string, unknown>)?.sandboxId;
                if (typeof sandboxId !== "string") return;
                const snap = await deps.control.createSnapshot(sandboxId);
                await waitForSnapshot(deps.control, snap.id);
                await teeLedger.append({
                  ts: Date.now(),
                  workflowName: wfName,
                  runId: rid,
                  stepIndex,
                  event: LedgerEvent.Snapshot,
                  payload: { snapshotId: snap.id, sandboxId },
                });
              },
            }
          : undefined;

        const teeDeps: WorkflowDeps = { ...deps, ledger: teeLedger, hooks: snapshotHook };

        emit({ event: LedgerEvent.RunStarted, workflowName, runId, stepIndex: -1, ts: Date.now(), payload: { workflowName, runId } });

        let workflow: Workflow | undefined;
        try {
          let nextStep: number;
          let lastOutput: unknown;

          if (resumeMode) {
            ({ workflow, nextStep, lastOutput } = await Workflow.resumeFromLedger(
              workflowName,
              runId,
              steps,
              teeDeps,
            ));
          } else {
            workflow = new Workflow(workflowName, runId, steps, teeDeps);
            nextStep = 0;
            lastOutput = {};
          }

          await workflow.run(lastOutput, nextStep);
        } catch (err) {
          try { await workflow?.rollback(); } catch { /* ignore rollback errors */ }
          emit({ event: "workflow_failed", workflowName, runId, error: String(err), ts: Date.now(), stepIndex: -1 });
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

// ── Elysia validation schemas ──────────────────────────────────────────────

const ImageSpecSchema = t.Object({
  uri: t.String(),
  auth: t.Optional(t.Object({ username: t.String(), password: t.String() })),
});

const ResourcesSchema = t.Object({
  cpu: t.Optional(t.String()),
  memory: t.Optional(t.String()),
  gpu: t.Optional(t.String()),
});

const PredicateSchema = t.Recursive((Self) =>
  t.Union([
    t.Object({ op: t.Union([t.Literal("eq"), t.Literal("neq")]), field: t.String(), value: t.Any() }),
    t.Object({ op: t.Union([t.Literal("gt"), t.Literal("lt"), t.Literal("gte"), t.Literal("lte")]), field: t.String(), value: t.Number() }),
    t.Object({ op: t.Union([t.Literal("exists"), t.Literal("not_exists")]), field: t.String() }),
    t.Object({ op: t.Union([t.Literal("and"), t.Literal("or")]), predicates: t.Array(Self) }),
  ]),
);

const StepSchema = t.Recursive((Self) =>
  t.Object({
    type: t.Union([
      t.Literal("create_sandbox"),
      t.Literal("exec_code"),
      t.Literal("exec_command"),
      t.Literal("delete_sandbox"),
      t.Literal("write_file"),
      t.Literal("retry"),
      t.Literal("conditional"),
      t.Literal("loop"),
      t.Literal("parallel"),
      t.Literal("sequence"),
    ]),
    // create_sandbox
    image: t.Optional(ImageSpecSchema),
    snapshotId: t.Optional(t.String()),
    timeout: t.Optional(t.Number()),
    entrypoint: t.Optional(t.Array(t.String())),
    env: t.Optional(t.Record(t.String(), t.String())),
    metadata: t.Optional(t.Record(t.String(), t.String())),
    resourceLimits: t.Optional(ResourcesSchema),
    // exec_code
    code: t.Optional(t.String()),
    context: t.Optional(t.Object({ id: t.String(), language: t.String() })),
    // exec_command
    command: t.Optional(t.String()),
    cwd: t.Optional(t.String()),
    envs: t.Optional(t.Record(t.String(), t.String())),
    // write_file
    path: t.Optional(t.String()),
    content: t.Optional(t.String()),
    encoding: t.Optional(t.Union([t.Literal("utf8"), t.Literal("base64")])),
    // retry
    step: t.Optional(Self),
    maxAttempts: t.Optional(t.Number()),
    delayMs: t.Optional(t.Number()),
    backoff: t.Optional(t.Union([t.Literal("fixed"), t.Literal("exponential")])),
    // conditional
    condition: t.Optional(PredicateSchema),
    then: t.Optional(t.Array(Self)),
    else: t.Optional(t.Array(Self)),
    // loop
    over: t.Optional(t.String()),
    items: t.Optional(t.Array(t.Any())),
    as: t.Optional(t.String()),
    steps: t.Optional(t.Array(Self)),
    concurrently: t.Optional(t.Boolean()),
    // parallel reuses steps above
  }),
);

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

  .get("/v1/sandboxes/:id/diagnostics/logs", ({ params }) => control.getDiagnosticLogs(params.id))
  .get("/v1/sandboxes/:id/diagnostics/events", ({ params }) => control.getDiagnosticEvents(params.id))

  // ── Code execution ─────────────────────────────────────────────────────────

  .post(
    "/v1/sandboxes/:id/exec/code",
    async ({ params, body }) => {
      const exec = await resolveExecClient(control, params.id);
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
    const exec = await resolveExecClient(control, params.id);
    return exec.interruptCode();
  })

  // ── Code contexts ──────────────────────────────────────────────────────────

  .get(
    "/v1/sandboxes/:id/exec/contexts",
    async ({ params, query }) => {
      const exec = await resolveExecClient(control, params.id);
      return exec.listContexts(query.language);
    },
    { query: t.Object({ language: t.Optional(t.String()) }) },
  )
  .post(
    "/v1/sandboxes/:id/exec/contexts",
    async ({ params, body }) => {
      const exec = await resolveExecClient(control, params.id);
      return exec.createContext(body.language);
    },
    { body: t.Object({ language: t.String() }) },
  )
  .delete(
    "/v1/sandboxes/:id/exec/contexts",
    async ({ params, query }) => {
      const exec = await resolveExecClient(control, params.id);
      return exec.clearContexts(query.language);
    },
    { query: t.Object({ language: t.Optional(t.String()) }) },
  )
  .delete("/v1/sandboxes/:id/exec/contexts/:ctxId", async ({ params }) => {
    const exec = await resolveExecClient(control, params.id);
    return exec.deleteContext(params.ctxId);
  })

  // ── Command execution ──────────────────────────────────────────────────────

  .post(
    "/v1/sandboxes/:id/exec/command",
    async ({ params, body }) => {
      const exec = await resolveExecClient(control, params.id);
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
    const exec = await resolveExecClient(control, params.id);
    return exec.interruptCommand();
  })
  .get("/v1/sandboxes/:id/exec/command/status/:session", async ({ params }) => {
    const exec = await resolveExecClient(control, params.id);
    return exec.getCommandStatus(params.session);
  })
  .get("/v1/sandboxes/:id/exec/command/output/:session", async ({ params }) => {
    const exec = await resolveExecClient(control, params.id);
    return exec.getCommandOutput(params.session);
  })

  // ── Files ──────────────────────────────────────────────────────────────────

  .get(
    "/v1/sandboxes/:id/files/info",
    async ({ params, query }) => {
      const exec = await resolveExecClient(control, params.id);
      return exec.getFileInfo(query.path);
    },
    { query: t.Object({ path: t.String() }) },
  )
  .delete(
    "/v1/sandboxes/:id/files",
    async ({ params, query }) => {
      const exec = await resolveExecClient(control, params.id);
      return exec.deleteFile(query.path);
    },
    { query: t.Object({ path: t.String() }) },
  )
  .post(
    "/v1/sandboxes/:id/files/permissions",
    async ({ params, body }) => {
      const exec = await resolveExecClient(control, params.id);
      return exec.setPermissions(body.path, body.mode);
    },
    { body: t.Object({ path: t.String(), mode: t.String() }) },
  )
  .post(
    "/v1/sandboxes/:id/files/move",
    async ({ params, body }) => {
      const exec = await resolveExecClient(control, params.id);
      return exec.moveFile(body.from, body.to);
    },
    { body: t.Object({ from: t.String(), to: t.String() }) },
  )
  .get(
    "/v1/sandboxes/:id/files/search",
    async ({ params, query }) => {
      const exec = await resolveExecClient(control, params.id);
      return exec.searchFiles(query.pattern, query.dir);
    },
    { query: t.Object({ pattern: t.String(), dir: t.Optional(t.String()) }) },
  )
  .post(
    "/v1/sandboxes/:id/files/replace",
    async ({ params, body }) => {
      const exec = await resolveExecClient(control, params.id);
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
      const exec = await resolveExecClient(control, params.id);
      await exec.uploadFile(body.path, body.file);
      return { ok: true };
    },
    { body: t.Object({ file: t.File(), path: t.String() }) },
  )
  .get(
    "/v1/sandboxes/:id/files/download",
    async ({ params, query }) => {
      const exec = await resolveExecClient(control, params.id);
      const stream = await exec.downloadFile(query.path);
      return new Response(stream, { headers: { "Content-Type": "application/octet-stream" } });
    },
    { query: t.Object({ path: t.String() }) },
  )

  // ── Directories ────────────────────────────────────────────────────────────

  .get(
    "/v1/sandboxes/:id/directories",
    async ({ params, query }) => {
      const exec = await resolveExecClient(control, params.id);
      return exec.listDirectory(query.path, query.depth ? Number(query.depth) : undefined);
    },
    { query: t.Object({ path: t.String(), depth: t.Optional(t.String()) }) },
  )
  .post(
    "/v1/sandboxes/:id/directories",
    async ({ params, body }) => {
      const exec = await resolveExecClient(control, params.id);
      return exec.createDirectory(body.path);
    },
    { body: t.Object({ path: t.String() }) },
  )
  .delete(
    "/v1/sandboxes/:id/directories",
    async ({ params, query }) => {
      const exec = await resolveExecClient(control, params.id);
      return exec.deleteDirectory(query.path);
    },
    { query: t.Object({ path: t.String() }) },
  )

  // ── Metrics ────────────────────────────────────────────────────────────────

  .get("/v1/sandboxes/:id/metrics", async ({ params }) => {
    const exec = await resolveExecClient(control, params.id);
    return exec.getMetrics();
  })
  .get("/v1/sandboxes/:id/metrics/watch", async ({ params }) => {
    const exec = await resolveExecClient(control, params.id);
    return sseResponse(exec.watchMetrics());
  })

  // ── Workflows ──────────────────────────────────────────────────────────────

  .post(
    "/v1/workflows/:name/runs",
    ({ params, body }) => {
      const runId = crypto.randomUUID();
      const steps = (body.steps as unknown as StepDef[]).map(buildStep);
      const snapshotConfig = body.snapshotConfig as SnapshotConfig | undefined;
      return workflowSseResponse(params.name, runId, steps, workflowDeps, false, snapshotConfig);
    },
    {
      body: t.Object({
        steps: t.Array(StepSchema),
        snapshotConfig: t.Optional(
          t.Object({
            afterSteps: t.Optional(t.Array(t.Number())),
            everyNSteps: t.Optional(t.Number()),
          }),
        ),
      }),
    },
  )
  .post(
    "/v1/workflows/:name/runs/:runId/resume",
    ({ params, body }) => {
      const steps = (body.steps as unknown as StepDef[]).map(buildStep);
      return workflowSseResponse(params.name, params.runId, steps, workflowDeps, true);
    },
    {
      body: t.Object({
        steps: t.Array(StepSchema),
      }),
    },
  )
  .get("/v1/workflows/:name/runs", ({ params }) =>
    workflowDeps.ledger.listRuns(params.name).then((runs) => ({ runs })),
  )
  .get("/v1/workflows/:name/runs/:runId/ledger", ({ params }) =>
    workflowDeps.ledger.readAll(params.name, params.runId),
  )

  .listen(PORT);

console.log(`drej API running at ${app.server?.hostname}:${app.server?.port}`);
