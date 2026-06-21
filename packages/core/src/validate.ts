import type { StepDef } from "./steps";

type CreateSandboxStep = Extract<StepDef, { type: "create_sandbox" }>;

function isCodeInterpreterSandbox(step: CreateSandboxStep): boolean {
  return (step.entrypoint ?? []).some((e) => e.includes("code-interpreter.sh"));
}

function walkSteps(
  steps: StepDef[],
  workflowName: string,
  sandboxCtx: CreateSandboxStep | undefined,
): string[] {
  const errors: string[] = [];
  let currentSandbox = sandboxCtx;

  for (const step of steps) {
    switch (step.type) {
      case "create_sandbox":
        currentSandbox = step;
        break;

      case "exec_code":
        if (currentSandbox && !isCodeInterpreterSandbox(currentSandbox)) {
          errors.push(
            `Workflow "${workflowName}": execCode() requires the opensandbox/code-interpreter image.\n` +
            `  Set entrypoint: ["/opt/code-interpreter/code-interpreter.sh"] in your sandbox options.`,
          );
        }
        break;

      case "retry":
        errors.push(...walkSteps(
          step.step.type === "sequence" ? step.step.steps : [step.step],
          workflowName,
          currentSandbox,
        ));
        break;

      case "conditional":
        errors.push(...walkSteps(step.then, workflowName, currentSandbox));
        if (step.else) errors.push(...walkSteps(step.else, workflowName, currentSandbox));
        break;

      case "loop":
        errors.push(...walkSteps(step.steps, workflowName, currentSandbox));
        break;

      case "parallel":
        for (const branch of step.steps) {
          errors.push(...walkSteps(
            branch.type === "sequence" ? branch.steps : [branch],
            workflowName,
            currentSandbox,
          ));
        }
        break;

      case "sequence":
        errors.push(...walkSteps(step.steps, workflowName, currentSandbox));
        break;
    }
  }

  return errors;
}

export function validateWorkflow(name: string, steps: StepDef[]): void {
  // Deduplicate so repeated violations in the same sandbox don't flood the message
  const errors = [...new Set(walkSteps(steps, name, undefined))];
  if (errors.length > 0) {
    throw new Error(errors.join("\n\n"));
  }
}
