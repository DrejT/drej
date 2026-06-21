import { StepType, type StepDef } from "./steps";

type CreateSandboxStep = Extract<StepDef, { type: StepType.CreateSandbox }>;

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
      case StepType.CreateSandbox:
        currentSandbox = step;
        break;

      case StepType.ExecCode:
        if (currentSandbox && !isCodeInterpreterSandbox(currentSandbox)) {
          errors.push(
            `Workflow "${workflowName}": execCode() requires the opensandbox/code-interpreter image.\n` +
            `  Set entrypoint: ["/opt/code-interpreter/code-interpreter.sh"] in your sandbox options.`,
          );
        }
        break;

      case StepType.Retry:
        errors.push(...walkSteps(
          step.step.type === StepType.Sequence ? step.step.steps : [step.step],
          workflowName,
          currentSandbox,
        ));
        break;

      case StepType.Conditional:
        errors.push(...walkSteps(step.then, workflowName, currentSandbox));
        if (step.else) errors.push(...walkSteps(step.else, workflowName, currentSandbox));
        break;

      case StepType.Loop:
        errors.push(...walkSteps(step.steps, workflowName, currentSandbox));
        break;

      case StepType.Parallel:
        for (const branch of step.steps) {
          errors.push(...walkSteps(
            branch.type === StepType.Sequence ? branch.steps : [branch],
            workflowName,
            currentSandbox,
          ));
        }
        break;

      case StepType.Sequence:
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
