import { describe, expect, it, vi } from "vitest";
import { buildExecCommandStep } from "../src/steps/exec.ts";
import { buildStep } from "../src/steps/index.ts";
import { StepType } from "../src/steps/types.ts";
import type { WorkflowRunContext } from "../src/workflow.ts";

function makeExecClient() {
  return {
    executeCommand: vi.fn().mockImplementation(() => (async function* () {})()),
  };
}

function makeCtx(exec: ReturnType<typeof makeExecClient>): WorkflowRunContext {
  return {
    workflowName: "test-wf",
    runId: "run-1",
    stepIndex: 0,
    control: {} as any,
    resolveExec: async () => exec as any,
    emit: vi.fn().mockResolvedValue(undefined),
  };
}

describe("buildExecCommandStep interpolation", () => {
  it("interpolates cwd against state", async () => {
    const exec = makeExecClient();
    const step = buildExecCommandStep({ type: StepType.ExecCommand, command: "ls", cwd: "/app/{{sha}}" });
    await step.run({ sandboxId: "sb-1", sha: "abc123" }, makeCtx(exec));
    expect(exec.executeCommand).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/app/abc123" }));
  });

  it("interpolates envs values against state", async () => {
    const exec = makeExecClient();
    const step = buildExecCommandStep({
      type: StepType.ExecCommand,
      command: "deploy.sh",
      envs: { GIT_SHA: "{{sha}}", ENV: "prod" },
    });
    await step.run({ sandboxId: "sb-1", sha: "abc123" }, makeCtx(exec));
    expect(exec.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ envs: { GIT_SHA: "abc123", ENV: "prod" } }),
    );
  });

  it("passes undefined cwd when not set", async () => {
    const exec = makeExecClient();
    const step = buildExecCommandStep({ type: StepType.ExecCommand, command: "echo hi" });
    await step.run({ sandboxId: "sb-1" }, makeCtx(exec));
    expect(exec.executeCommand).toHaveBeenCalledWith(expect.objectContaining({ cwd: undefined }));
  });

  it("passes undefined envs when not set", async () => {
    const exec = makeExecClient();
    const step = buildExecCommandStep({ type: StepType.ExecCommand, command: "echo hi" });
    await step.run({ sandboxId: "sb-1" }, makeCtx(exec));
    expect(exec.executeCommand).toHaveBeenCalledWith(expect.objectContaining({ envs: undefined }));
  });
});

describe("buildStep timeoutMs stamping", () => {
  it("stamps timeoutMs from def onto the built step", () => {
    const step = buildStep({ type: StepType.ExecCommand, command: "echo hi", timeoutMs: 5_000 });
    expect(step.timeoutMs).toBe(5_000);
  });

  it("leaves timeoutMs undefined when not set", () => {
    const step = buildStep({ type: StepType.ExecCommand, command: "echo hi" });
    expect(step.timeoutMs).toBeUndefined();
  });

  it("stamps timeoutMs for file steps", () => {
    const step = buildStep({ type: StepType.ReadFile, path: "/tmp/f", as: "k", timeoutMs: 3_000 });
    expect(step.timeoutMs).toBe(3_000);
  });

  it("does not stamp timeoutMs for control-flow steps", () => {
    const step = buildStep({
      type: StepType.Sequence,
      steps: [{ type: StepType.ExecCommand, command: "echo hi", timeoutMs: 5_000 }],
    });
    expect(step.timeoutMs).toBeUndefined();
  });
});
