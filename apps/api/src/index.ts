import { Elysia, t } from "elysia";
import { ControlClient, ExecClient, OpenSandboxError, OpenSandboxControlAdapter, OpenSandboxExecFactory } from "@drej/opensandbox";
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

// Used by direct sandbox exec routes (/v1/sandboxes/:id/exec/*)
// which need the full ExecClient surface, not just ISandboxExec.
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

const workflowDeps: WorkflowDeps = {
  control: new OpenSandboxControlAdapter(control),
  execFactory: new OpenSandboxExecFactory(control),
  ledger: new NdjsonLedger(LEDGER_DIR),
  logger,
};

// ── Workflow step definitions ──────────────────────────────────────────────

enum StepType {
  CreateSandbox = "create_sandbox",
  ExecCode = "exec_code",
  ExecCommand = "exec_command",
  DeleteSandbox = "delete_sandbox",
  WriteFile = "write_file",
  Retry = "retry",
  Conditional = "conditional",
  Loop = "loop",
  Parallel = "parallel",
  Sequence = "sequence",
}

type Predicate =
  | { op: "eq" | "neq"; field: string; value: unknown }
  | { op: "gt" | "lt" | "gte" | "lte"; field: string; value: number }
  | { op: "exists" | "not_exists"; field: string }
  | { op: "and" | "or"; predicates: Predicate[] };

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
  | { type: StepType.DeleteSandbox }
  | { type: StepType.WriteFile; path: string; content: string; encoding?: "utf8" | "base64" }
  | { type: StepType.Retry; step: StepDef; maxAttempts: number; delayMs?: number; backoff?: "fixed" | "exponential" }
  | { type: StepType.Conditional; condition: Predicate; then: StepDef[]; else?: StepDef[] }
  | { type: StepType.Loop; over?: string; items?: unknown[]; as: string; steps: StepDef[]; concurrently?: boolean }
  | { type: StepType.Parallel; steps: StepDef[] }
  | { type: StepType.Sequence; steps: StepDef[] };

type WorkflowState = Record<string, unknown> & { sandboxId?: string };

// Resolves a dot-path into a plain object, e.g. "status.exitCode" → obj.status.exitCode
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

// Replaces {{key}} placeholders in a string with values from WorkflowState.
// Enables loop items and other state values to be referenced in exec_command strings.
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

    case StepType.ExecCommand:
      return {
        id: StepType.ExecCommand,
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const state = (input ?? {}) as WorkflowState;
          if (!state.sandboxId) throw new Error("exec_command requires sandboxId in workflow state");
          const exec = await ctx.execFactory.forSandbox(state.sandboxId);
          // Interpolate {{key}} placeholders from state (useful inside loop iterations).
          const raw = interpolate(def.command, state);
          // Always base64-encode so any content (newlines, quotes, special chars)
          // survives the JSON serialization boundary without quoting issues.
          const command = `echo ${Buffer.from(raw).toString("base64")} | base64 -d | bash`;
          const events: SSEEvent[] = [];
          for await (const ev of exec.executeCommand({ command, cwd: def.cwd, envs: def.envs })) {
            await ctx.emit({
              ts: Date.now(),
              workflowName: ctx.workflowName, runId: ctx.runId,
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

    case StepType.WriteFile:
      return {
        id: StepType.WriteFile,
        async run(input: unknown, ctx: WorkflowRunContext): Promise<unknown> {
          const state = (input ?? {}) as WorkflowState;
          if (!state.sandboxId) throw new Error("write_file requires sandboxId in workflow state");
          const exec = await ctx.execFactory.forSandbox(state.sandboxId);
          const content: string | Uint8Array = def.encoding === "base64"
            ? new Uint8Array(Buffer.from(def.content, "base64"))
            : def.content;
          await exec.uploadFile(def.path, content);
          return state;
        },
      };

    case StepType.Retry: {
      const child = buildStep(def.step);
      return {
        id: StepType.Retry,
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

    case StepType.Conditional: {
      const thenSteps = def.then.map(buildStep);
      const elseSteps = (def.else ?? []).map(buildStep);
      return {
        id: StepType.Conditional,
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

    case StepType.Loop: {
      return {
        id: StepType.Loop,
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

    case StepType.Parallel: {
      return {
        id: StepType.Parallel,
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

    case StepType.Sequence: {
      const childSteps = def.steps.map(buildStep);
      return {
        id: StepType.Sequence,
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
  workflowName: string,
  runId: string,
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
          readAll: (name, id) => deps.ledger.readAll(name, id),
          lastCheckpoint: (name, id) => deps.ledger.lastCheckpoint(name, id),
          listRuns: (name) => deps.ledger.listRuns(name),
        };

        const teeDeps: WorkflowDeps = { ...deps, ledger: teeLedger };

        // First event tells the client the auto-generated run ID
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
      t.Literal(StepType.CreateSandbox),
      t.Literal(StepType.ExecCode),
      t.Literal(StepType.ExecCommand),
      t.Literal(StepType.DeleteSandbox),
      t.Literal(StepType.WriteFile),
      t.Literal(StepType.Retry),
      t.Literal(StepType.Conditional),
      t.Literal(StepType.Loop),
      t.Literal(StepType.Parallel),
      t.Literal(StepType.Sequence),
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
    "/v1/workflows/:name/runs",
    ({ params, body }) => {
      const runId = crypto.randomUUID();
      const steps = (body.steps as unknown as StepDef[]).map(buildStep);
      return workflowSseResponse(params.name, runId, steps, workflowDeps, false);
    },
    {
      body: t.Object({
        steps: t.Array(StepSchema),
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
