import type { Tracer, Span } from "@opentelemetry/api";
import { SpanStatusCode as StatusCode, context, trace } from "@opentelemetry/api";
import type { SandboxHooks, ExecResult } from "@drej/core";

export interface OtelHooksOptions {
  /** Include exit code as a span attribute on exec spans. Default: true. */
  recordExitCode?: boolean;
}

/**
 * Returns `SandboxHooks` that emit OpenTelemetry traces for every sandbox run.
 *
 * Pass the result to `client.sandbox(opts, { hooks: otelHooks(tracer) })`.
 *
 * Span structure:
 * ```
 * sandbox.run            ← root span (sandboxId attribute)
 *   sandbox.exec         ← child per exec (cmd, exitCode, seq)
 *   sandbox.checkpoint   ← child per checkpoint (snapshotId)
 * ```
 *
 * @example
 * ```ts
 * import { otelHooks } from "@drej/otel";
 * import { trace } from "@opentelemetry/api";
 *
 * const tracer = trace.getTracer("my-app");
 * const sb = await client.sandbox({ image: "node:22" }, { hooks: otelHooks(tracer) });
 * ```
 */
export function otelHooks(tracer: Tracer, opts: OtelHooksOptions = {}): SandboxHooks {
  const { recordExitCode = true } = opts;

  let rootSpan: Span | undefined;
  let rootCtx: ReturnType<typeof context.active> | undefined;
  const execSpans = new Map<number, Span>();

  return {
    onSandboxCreated(sandboxId: string, name: string) {
      rootCtx = context.active();
      rootSpan = tracer.startSpan(
        "sandbox.run",
        {
          attributes: {
            "drej.sandbox.id": sandboxId,
            "drej.sandbox.name": name,
          },
        },
        rootCtx,
      );
    },

    onExecStart(sandboxId: string, seq: number, cmd: string) {
      if (!rootSpan || !rootCtx) return;
      const spanCtx = trace.setSpan(rootCtx, rootSpan);
      const span = tracer.startSpan(
        "sandbox.exec",
        {
          attributes: {
            "drej.sandbox.id": sandboxId,
            "drej.exec.seq": seq,
            "drej.exec.cmd": cmd,
          },
        },
        spanCtx,
      );
      execSpans.set(seq, span);
    },

    onExecComplete(_sandboxId: string, seq: number, result: ExecResult) {
      const span = execSpans.get(seq);
      if (!span) return;
      if (recordExitCode) span.setAttribute("process.exit_code", result.exitCode);
      span.setStatus({ code: result.exitCode === 0 ? StatusCode.OK : StatusCode.ERROR });
      span.end();
      execSpans.delete(seq);
    },

    onCheckpoint(sandboxId: string, snapshotId: string, name?: string) {
      if (!rootSpan || !rootCtx) return;
      const spanCtx = trace.setSpan(rootCtx, rootSpan);
      const span = tracer.startSpan(
        "sandbox.checkpoint",
        {
          attributes: {
            "drej.sandbox.id": sandboxId,
            "drej.snapshot.id": snapshotId,
            ...(name ? { "drej.checkpoint.name": name } : {}),
          },
        },
        spanCtx,
      );
      span.setStatus({ code: StatusCode.OK });
      span.end();
    },

    onSandboxClosed(_sandboxId: string) {
      rootSpan?.setStatus({ code: StatusCode.OK });
      rootSpan?.end();
      rootSpan = undefined;
    },

    onSandboxFailed(_sandboxId: string, error: Error) {
      rootSpan?.recordException(error);
      rootSpan?.setStatus({ code: StatusCode.ERROR, message: error.message });
      rootSpan?.end();
      rootSpan = undefined;
    },
  };
}
