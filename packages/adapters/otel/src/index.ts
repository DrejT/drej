import type { Tracer, Span, SpanStatusCode } from "@opentelemetry/api";
import { SpanStatusCode as StatusCode, context, trace } from "@opentelemetry/api";
import type {
  WorkflowHooks,
  StepHookInfo,
  StepCompleteHookInfo,
  StepFailedHookInfo,
  WorkflowCompleteHookInfo,
  WorkflowFailedHookInfo,
  WorkflowHookInfo,
} from "@drej/core";

export interface OtelHooksOptions {
  /** Include sandbox ID as a span attribute when present in step output. Default: true. */
  recordSandboxId?: boolean;
  /** Include exit code as a span attribute on exec_command steps. Default: true. */
  recordExitCode?: boolean;
}

/**
 * Returns `WorkflowHooks` that emit OpenTelemetry traces for every workflow run.
 *
 * Pass the result to `client.run(wf, { hooks: otelHooks(tracer) })`.
 *
 * Span structure:
 * ```
 * workflow.run          ← root span, name = workflow name
 *   workflow.step       ← child per step, name = step type
 *   workflow.step
 * ```
 *
 * @example
 * ```ts
 * import { otelHooks } from "@drej/otel";
 * import { trace } from "@opentelemetry/api";
 *
 * const tracer = trace.getTracer("my-app");
 * const run = await client.run(wf, { hooks: otelHooks(tracer) });
 * ```
 */
export function otelHooks(tracer: Tracer, opts: OtelHooksOptions = {}): WorkflowHooks {
  const { recordSandboxId = true, recordExitCode = true } = opts;

  let rootSpan: Span | undefined;
  let rootCtx: ReturnType<typeof context.active> | undefined;
  const stepSpans = new Map<number, Span>();

  return {
    onWorkflowStart({ workflowName, runId }: WorkflowHookInfo) {
      rootCtx = context.active();
      rootSpan = tracer.startSpan(
        "workflow.run",
        {
          attributes: {
            "drej.workflow.name": workflowName,
            "drej.run.id": runId,
          },
        },
        rootCtx,
      );
    },

    onStepStart({ stepIndex, stepId }: StepHookInfo) {
      if (!rootSpan || !rootCtx) return;
      const spanCtx = trace.setSpan(rootCtx, rootSpan);
      const span = tracer.startSpan(
        "workflow.step",
        {
          attributes: {
            "drej.step.index": stepIndex,
            "drej.step.type": stepId,
          },
        },
        spanCtx,
      );
      stepSpans.set(stepIndex, span);
    },

    onStepComplete({ stepIndex, output }: StepCompleteHookInfo) {
      const span = stepSpans.get(stepIndex);
      if (!span) return;
      if (recordSandboxId) {
        const sandboxId = (output as Record<string, unknown>)?.sandboxId;
        if (typeof sandboxId === "string") span.setAttribute("drej.sandbox.id", sandboxId);
      }
      if (recordExitCode) {
        const exitCode = (output as Record<string, unknown>)?.exitCode;
        if (typeof exitCode === "number") span.setAttribute("process.exit_code", exitCode);
      }
      span.setStatus({ code: StatusCode.OK });
      span.end();
      stepSpans.delete(stepIndex);
    },

    onStepFailed({ stepIndex, error }: StepFailedHookInfo) {
      const span = stepSpans.get(stepIndex);
      if (!span) return;
      span.recordException(error);
      span.setStatus({ code: StatusCode.ERROR, message: error.message });
      span.end();
      stepSpans.delete(stepIndex);
    },

    onWorkflowComplete(_info: WorkflowCompleteHookInfo) {
      rootSpan?.setStatus({ code: StatusCode.OK });
      rootSpan?.end();
      rootSpan = undefined;
    },

    onWorkflowFailed({ error }: WorkflowFailedHookInfo) {
      rootSpan?.recordException(error);
      rootSpan?.setStatus({ code: StatusCode.ERROR, message: error.message });
      rootSpan?.end();
      rootSpan = undefined;
    },
  };
}
