import { Backoff, Encoding, StepType } from "@drej/core";
import { describe, expect, it } from "vitest";
import { SandboxStepBuilder } from "../src/builder/sandbox-step.ts";
import { createLoopVar, ref, wrapSteps } from "../src/builder/types.ts";
import { workflow } from "../src/builder/workflow.ts";

// ── wrapSteps ────────────────────────────────────────────────────────────────

describe("wrapSteps", () => {
  it("returns the step directly when there is only one", () => {
    const step = { type: StepType.ExecCommand as const, command: "echo hi" };
    expect(wrapSteps([step])).toBe(step);
  });

  it("wraps multiple steps in a Sequence", () => {
    const steps = [
      { type: StepType.ExecCommand as const, command: "a" },
      { type: StepType.ExecCommand as const, command: "b" },
    ];
    expect(wrapSteps(steps)).toEqual({ type: StepType.Sequence, steps });
  });
});

// ── createLoopVar ─────────────────────────────────────────────────────────────

describe("createLoopVar", () => {
  it("serialises to the interpolation template", () => {
    expect(String(createLoopVar("file"))).toBe("{{file}}");
  });

  it("uses the given name in the template", () => {
    expect(String(createLoopVar("row"))).toBe("{{row}}");
  });
});

// ── SandboxStepBuilder ────────────────────────────────────────────────────────

describe("SandboxStepBuilder", () => {
  it("exec adds an ExecCommand step", () => {
    const steps = new SandboxStepBuilder().exec("ls -la").build();
    expect(steps).toEqual([{ type: StepType.ExecCommand, command: "ls -la" }]);
  });

  it("exec forwards optional fields", () => {
    const steps = new SandboxStepBuilder()
      .exec("npm test", { cwd: "/app", capture: "output", strict: true })
      .build();
    expect(steps[0]).toMatchObject({ cwd: "/app", capture: "output", strict: true });
  });

  it("writeFile adds a WriteFile step with optional encoding", () => {
    const steps = new SandboxStepBuilder()
      .writeFile("/tmp/a.txt", "hello")
      .writeFile("/tmp/b.bin", "data", Encoding.Base64)
      .build();
    expect(steps[0]).toEqual({ type: StepType.WriteFile, path: "/tmp/a.txt", content: "hello" });
    expect(steps[1]).toEqual({ type: StepType.WriteFile, path: "/tmp/b.bin", content: "data", encoding: Encoding.Base64 });
  });

  it("readFile adds a ReadFile step", () => {
    const steps = new SandboxStepBuilder().readFile("/tmp/out.txt", { as: "result" }).build();
    expect(steps[0]).toEqual({ type: StepType.ReadFile, path: "/tmp/out.txt", as: "result" });
  });

  it("snapshot adds a Snapshot step", () => {
    const steps = new SandboxStepBuilder().snapshot().build();
    expect(steps[0]).toEqual({ type: StepType.Snapshot });
  });

  it("retry wraps inner steps and sets maxAttempts", () => {
    const steps = new SandboxStepBuilder()
      .retry(3, (r) => r.exec("flaky"), { delayMs: 100, backoff: Backoff.Exponential })
      .build();
    expect(steps[0]).toMatchObject({
      type: StepType.Retry,
      maxAttempts: 3,
      delayMs: 100,
      backoff: Backoff.Exponential,
    });
    expect((steps[0] as any).step).toEqual({ type: StepType.ExecCommand, command: "flaky" });
  });

  it("retry wraps multiple inner steps in a Sequence", () => {
    const steps = new SandboxStepBuilder()
      .retry(2, (r) => r.exec("a").exec("b"))
      .build();
    expect((steps[0] as any).step.type).toBe(StepType.Sequence);
  });

  it("forEach with static items produces a Loop step", () => {
    const steps = new SandboxStepBuilder()
      .forEach(["a.txt", "b.txt"], (s, item) => s.exec(`cat ${item}`))
      .build();
    expect(steps[0]).toMatchObject({
      type: StepType.Loop,
      items: ["a.txt", "b.txt"],
      as: "item",
    });
  });

  it("forEach with { from } uses the over field", () => {
    const steps = new SandboxStepBuilder()
      .forEach({ from: "files" }, (s, item) => s.exec(`process ${item}`))
      .build();
    expect(steps[0]).toMatchObject({ type: StepType.Loop, over: "files" });
  });

  it("forEach with custom as name sets the loop variable", () => {
    const steps = new SandboxStepBuilder()
      .forEach(["x"], { as: "row" }, (s, item) => s.exec(`echo ${item}`))
      .build();
    expect((steps[0] as any).as).toBe("row");
  });

  it("forEach with concurrency sets maxConcurrency", () => {
    const steps = new SandboxStepBuilder()
      .forEach(["a", "b"], { concurrency: 4 }, (s, item) => s.exec(`echo ${item}`))
      .build();
    expect((steps[0] as any).maxConcurrency).toBe(4);
  });

  it("when adds a Conditional step with then branch", () => {
    const steps = new SandboxStepBuilder()
      .when({ op: "eq", field: "exitCode", value: 0 }, (s) => s.exec("echo ok"))
      .build();
    expect(steps[0]).toMatchObject({ type: StepType.Conditional });
    expect((steps[0] as any).then).toEqual([{ type: StepType.ExecCommand, command: "echo ok" }]);
    expect((steps[0] as any).else).toBeUndefined();
  });

  it("when adds an else branch when provided", () => {
    const steps = new SandboxStepBuilder()
      .when(
        { op: "eq", field: "x", value: 1 },
        (s) => s.exec("echo yes"),
        (s) => s.exec("echo no"),
      )
      .build();
    expect((steps[0] as any).else).toEqual([{ type: StepType.ExecCommand, command: "echo no" }]);
  });

  it("parallel adds a Parallel step with branches", () => {
    const steps = new SandboxStepBuilder()
      .parallel((p) => p.branch((b) => b.exec("lint")).branch((b) => b.exec("test")))
      .build();
    expect(steps[0]).toMatchObject({ type: StepType.Parallel });
    expect((steps[0] as any).steps).toHaveLength(2);
  });

  it("parallel sets maxConcurrency when provided", () => {
    const steps = new SandboxStepBuilder()
      .parallel((p) => p.branch((b) => b.exec("a")), { concurrency: 2 })
      .build();
    expect((steps[0] as any).maxConcurrency).toBe(2);
  });

  it("chains multiple methods in order", () => {
    const steps = new SandboxStepBuilder()
      .exec("step1")
      .writeFile("/tmp/f", "x")
      .exec("step3")
      .build();
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ command: "step1" });
    expect(steps[2]).toMatchObject({ command: "step3" });
  });
});

// ── ref ───────────────────────────────────────────────────────────────────────

describe("ref", () => {
  it("toString returns the interpolation template", () => {
    expect(String(ref("sha"))).toBe("{{sha}}");
  });

  it("key property holds the state key name", () => {
    expect(ref("myKey").key).toBe("myKey");
  });

  it("works naturally in template literals", () => {
    const sha = ref<string>("sha");
    expect(`echo ${sha}`).toBe("echo {{sha}}");
  });
});

// ── SandboxStepBuilder — ref + new file methods ───────────────────────────────

describe("SandboxStepBuilder (ref + file ops)", () => {
  it("exec: Ref capture resolves to its key", () => {
    const sha = ref<string>("sha");
    const [step] = new SandboxStepBuilder().exec("git rev-parse HEAD", { capture: sha }).build();
    expect((step as any).capture).toBe("sha");
  });

  it("exec: Ref envs values resolve to interpolation strings", () => {
    const sha = ref<string>("sha");
    const [step] = new SandboxStepBuilder().exec("deploy.sh", { envs: { GIT_SHA: sha } }).build();
    expect((step as any).envs.GIT_SHA).toBe("{{sha}}");
  });

  it("exec: string envs values are passed through unchanged", () => {
    const [step] = new SandboxStepBuilder().exec("run.sh", { envs: { MODE: "prod" } }).build();
    expect((step as any).envs.MODE).toBe("prod");
  });

  it("readFile: Ref as resolves to its key", () => {
    const result = ref<string>("result");
    const [step] = new SandboxStepBuilder().readFile("/out.txt", { as: result }).build();
    expect((step as any).as).toBe("result");
  });

  it("writeFile: Ref content resolves to interpolation string", () => {
    const body = ref<string>("body");
    const [step] = new SandboxStepBuilder().writeFile("/out.txt", body).build();
    expect((step as any).content).toBe("{{body}}");
  });

  it("deleteFile produces a DeleteFile step", () => {
    const [step] = new SandboxStepBuilder().deleteFile("/tmp/build.log").build();
    expect(step).toEqual({ type: StepType.DeleteFile, path: "/tmp/build.log" });
  });

  it("moveFile produces a MoveFile step", () => {
    const [step] = new SandboxStepBuilder().moveFile("/app/dist", "/app/release").build();
    expect(step).toEqual({ type: StepType.MoveFile, from: "/app/dist", to: "/app/release" });
  });

  it("listDirectory produces a ListDirectory step with Ref as", () => {
    const entries = ref<unknown[]>("entries");
    const [step] = new SandboxStepBuilder().listDirectory("/app", { as: entries, depth: 2 }).build();
    expect(step).toEqual({ type: StepType.ListDirectory, path: "/app", as: "entries", depth: 2 });
  });

  it("listDirectory omits depth when not provided", () => {
    const [step] = new SandboxStepBuilder().listDirectory("/app", { as: "items" }).build();
    expect((step as any).depth).toBeUndefined();
  });

  it("searchFiles produces a SearchFiles step with Ref as", () => {
    const files = ref<string[]>("files");
    const [step] = new SandboxStepBuilder().searchFiles("**/*.ts", { as: files, dir: "/src" }).build();
    expect(step).toEqual({ type: StepType.SearchFiles, pattern: "**/*.ts", as: "files", dir: "/src" });
  });

  it("searchFiles omits dir when not provided", () => {
    const [step] = new SandboxStepBuilder().searchFiles("*.ts", { as: "files" }).build();
    expect((step as any).dir).toBeUndefined();
  });

  it("forEach accepts a Ref source and uses over field", () => {
    const files = ref<string[]>("files");
    const [step] = new SandboxStepBuilder()
      .forEach(files, (s, item) => s.exec(`process ${item}`))
      .build();
    expect((step as any).over).toBe("files");
    expect((step as any).items).toBeUndefined();
  });
});

// ── WorkflowBuilder ──────────────────────────────────────────────────────────

describe("workflow builder", () => {
  it("sandbox with opts prepends a CreateSandbox step", () => {
    const { steps } = workflow("test")
      .sandbox({ image: { uri: "node:20-slim" } }, (s) => s.exec("npm test"))
      .build();

    expect(steps[0]).toMatchObject({ type: StepType.CreateSandbox, image: { uri: "node:20-slim" } });
    expect(steps[0]).toMatchObject({ entrypoint: ["tail", "-f", "/dev/null"] });
    expect(steps[1]).toEqual({ type: StepType.ExecCommand, command: "npm test" });
  });

  it("sandbox with existing Sandbox object skips CreateSandbox and sets initialState", () => {
    const { steps, initialState } = workflow("test")
      .sandbox({ id: "sb-123", status: "running" } as any, (s) => s.exec("ls"))
      .build();

    expect(steps[0]).toEqual({ type: StepType.ExecCommand, command: "ls" });
    expect(initialState.sandboxId).toBe("sb-123");
  });

  it("parallel adds a Parallel step", () => {
    const { steps } = workflow("test")
      .parallel((p) =>
        p
          .sandbox({ image: { uri: "node:20" } }, (s) => s.exec("lint"))
          .sandbox({ image: { uri: "node:20" } }, (s) => s.exec("test")),
      )
      .build();

    expect(steps[0]).toMatchObject({ type: StepType.Parallel });
    expect((steps[0] as any).steps).toHaveLength(2);
  });

  it("parallel forwards concurrency option", () => {
    const { steps } = workflow("test")
      .parallel(
        (p) => p.sandbox({ image: { uri: "node:20" } }, (s) => s.exec("a")),
        { concurrency: 3 },
      )
      .build();

    expect((steps[0] as any).maxConcurrency).toBe(3);
  });

  it("build returns the workflow name", () => {
    const { name } = workflow("my-workflow").sandbox({ image: { uri: "alpine" } }, (s) => s.exec("echo hi")).build();
    expect(name).toBe("my-workflow");
  });
});
