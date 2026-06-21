import { StepType } from "../src/steps/types.ts";
import { validateWorkflow } from "../src/validate.ts";
import { describe, expect, it } from "vitest";

describe("validateWorkflow", () => {
  it("passes for a workflow with no execCode steps", () => {
    expect(() =>
      validateWorkflow("wf", [{ type: StepType.ExecCommand, command: "echo hi" }]),
    ).not.toThrow();
  });

  it("throws when execCode is used without a code-interpreter sandbox", () => {
    expect(() =>
      validateWorkflow("wf", [
        { type: StepType.CreateSandbox, entrypoint: ["tail", "-f", "/dev/null"] },
        { type: StepType.ExecCode, code: "print(1)" },
      ]),
    ).toThrow(/code-interpreter/);
  });

  it("passes when execCode is used with a code-interpreter sandbox", () => {
    expect(() =>
      validateWorkflow("wf", [
        {
          type: StepType.CreateSandbox,
          entrypoint: ["/opt/code-interpreter/code-interpreter.sh"],
        },
        { type: StepType.ExecCode, code: "print(1)" },
      ]),
    ).not.toThrow();
  });

  it("catches execCode inside a Retry step", () => {
    expect(() =>
      validateWorkflow("wf", [
        { type: StepType.CreateSandbox, entrypoint: ["tail", "-f", "/dev/null"] },
        {
          type: StepType.Retry,
          maxAttempts: 3,
          step: { type: StepType.ExecCode, code: "x = 1" },
        },
      ]),
    ).toThrow(/code-interpreter/);
  });

  it("catches execCode inside a Conditional then branch", () => {
    expect(() =>
      validateWorkflow("wf", [
        { type: StepType.CreateSandbox, entrypoint: ["tail", "-f", "/dev/null"] },
        {
          type: StepType.Conditional,
          condition: { op: "eq", field: "x", value: 1 },
          then: [{ type: StepType.ExecCode, code: "x = 1" }],
        },
      ]),
    ).toThrow(/code-interpreter/);
  });

  it("deduplicates repeated error messages for the same sandbox violation", () => {
    let errorMessage = "";
    try {
      validateWorkflow("wf", [
        { type: StepType.CreateSandbox, entrypoint: ["tail", "-f", "/dev/null"] },
        { type: StepType.ExecCode, code: "x = 1" },
        { type: StepType.ExecCode, code: "y = 2" },
      ]);
    } catch (e) {
      errorMessage = (e as Error).message;
    }
    // Two execCode steps produce the same error string; Set deduplication means
    // only one error block appears in the joined message.
    const errorBlocks = errorMessage.split("\n\n").filter(Boolean);
    expect(errorBlocks).toHaveLength(1);
  });
});
