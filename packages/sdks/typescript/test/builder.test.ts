import { Backoff, Encoding, StepType } from "@drej/core";
import { describe, expect, it } from "vitest";
import { SandboxStepBuilder } from "../src/builder/sandbox-step.ts";
import { Ref, createLoopVar, wrapSteps } from "../src/builder/types.ts";
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

// ── Ref ───────────────────────────────────────────────────────────────────────

describe("Ref", () => {
  it("toString returns the interpolation template", () => {
    expect(String(new Ref("sha"))).toBe("{{sha}}");
  });

  it("key property holds the state key name", () => {
    expect(new Ref("myKey").key).toBe("myKey");
  });

  it("works naturally in template literals", () => {
    const sha = new Ref<string>("sha");
    expect(`echo ${sha}`).toBe("echo {{sha}}");
  });
});

// ── SandboxStepBuilder ────────────────────────────────────────────────────────

describe("SandboxStepBuilder", () => {
  it("exec adds an ExecCommand step and returns this", () => {
    const s = new SandboxStepBuilder();
    const result = s.exec("ls -la");
    expect(result).toBe(s);
    expect(s.build()).toEqual([{ type: StepType.ExecCommand, command: "ls -la" }]);
  });

  it("exec forwards optional cwd and strict fields", () => {
    const steps = new SandboxStepBuilder()
      .exec("npm test", { cwd: "/app", strict: true })
      .build();
    expect(steps[0]).toMatchObject({ cwd: "/app", strict: true });
  });

  it("exec with capture: true returns a Ref and stores the generated key", () => {
    const s = new SandboxStepBuilder();
    const output = s.exec("git rev-parse HEAD", { capture: true });
    expect(output).toBeInstanceOf(Ref);
    const steps = s.build();
    expect((steps[0] as any).capture).toBe(output.key);
    expect(output.toString()).toBe(`{{${output.key}}}`);
  });

  it("exec capture keys are auto-incremented per builder instance", () => {
    const s = new SandboxStepBuilder();
    const a = s.exec("cmd-a", { capture: true });
    const b = s.exec("cmd-b", { capture: true });
    expect(a.key).not.toBe(b.key);
    expect((s.build()[0] as any).capture).toBe(a.key);
    expect((s.build()[1] as any).capture).toBe(b.key);
  });

  it("exec envs values are passed through as strings", () => {
    const steps = new SandboxStepBuilder()
      .exec("run.sh", { envs: { MODE: "prod" } })
      .build();
    expect((steps[0] as any).envs.MODE).toBe("prod");
  });

  it("exec Ref value in envs works via template literal", () => {
    const s = new SandboxStepBuilder();
    const sha = s.exec("git rev-parse HEAD", { capture: true });
    s.exec("deploy.sh", { envs: { GIT_SHA: `${sha}` } });
    expect((s.build()[1] as any).envs.GIT_SHA).toBe(`{{${sha.key}}}`);
  });

  it("writeFile adds a WriteFile step with optional encoding", () => {
    const steps = new SandboxStepBuilder()
      .writeFile("/tmp/a.txt", "hello")
      .writeFile("/tmp/b.bin", "data", Encoding.Base64)
      .build();
    expect(steps[0]).toEqual({ type: StepType.WriteFile, path: "/tmp/a.txt", content: "hello" });
    expect(steps[1]).toEqual({ type: StepType.WriteFile, path: "/tmp/b.bin", content: "data", encoding: Encoding.Base64 });
  });

  it("writeFile accepts a Ref via template literal", () => {
    const s = new SandboxStepBuilder();
    const body = s.exec("cat template.txt", { capture: true });
    s.writeFile("/out.txt", `${body}`);
    expect((s.build()[1] as any).content).toBe(`{{${body.key}}}`);
  });

  it("readFile returns a Ref and adds a ReadFile step", () => {
    const s = new SandboxStepBuilder();
    const result = s.readFile("/tmp/out.txt");
    expect(result).toBeInstanceOf(Ref);
    const steps = s.build();
    expect(steps[0]).toMatchObject({ type: StepType.ReadFile, path: "/tmp/out.txt", as: result.key });
  });

  it("readFile auto-keys don't collide with exec capture keys", () => {
    const s = new SandboxStepBuilder();
    const a = s.exec("cmd", { capture: true });
    const b = s.readFile("/file.txt");
    expect(a.key).not.toBe(b.key);
  });

  it("snapshot adds a Snapshot step", () => {
    const steps = new SandboxStepBuilder().snapshot().build();
    expect(steps[0]).toEqual({ type: StepType.Snapshot });
  });

  it("retry wraps inner steps and sets maxAttempts", () => {
    const steps = new SandboxStepBuilder()
      .retry(3, (r) => { r.exec("flaky"); }, { delayMs: 100, backoff: Backoff.Exponential })
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
      .retry(2, (r) => { r.exec("a"); r.exec("b"); })
      .build();
    expect((steps[0] as any).step.type).toBe(StepType.Sequence);
  });

  it("forEach with static items produces a Loop step", () => {
    const steps = new SandboxStepBuilder()
      .forEach(["a.txt", "b.txt"], (s, item) => { s.exec(`cat ${item}`); })
      .build();
    expect(steps[0]).toMatchObject({
      type: StepType.Loop,
      items: ["a.txt", "b.txt"],
      as: "item",
    });
  });

  it("forEach with { from } uses the over field", () => {
    const steps = new SandboxStepBuilder()
      .forEach({ from: "files" }, (s, item) => { s.exec(`process ${item}`); })
      .build();
    expect(steps[0]).toMatchObject({ type: StepType.Loop, over: "files" });
  });

  it("forEach with a Ref source uses over field set to the Ref key", () => {
    const s = new SandboxStepBuilder();
    const files = s.searchFiles("*.ts", { dir: "/src" });
    s.forEach(files, (inner, item) => { inner.exec(`tsc ${item}`); });
    const steps = s.build();
    expect((steps[1] as any).over).toBe(files.key);
    expect((steps[1] as any).items).toBeUndefined();
  });

  it("forEach with custom as name sets the loop variable", () => {
    const steps = new SandboxStepBuilder()
      .forEach(["x"], { as: "row" }, (s, item) => { s.exec(`echo ${item}`); })
      .build();
    expect((steps[0] as any).as).toBe("row");
  });

  it("forEach with concurrency sets maxConcurrency", () => {
    const steps = new SandboxStepBuilder()
      .forEach(["a", "b"], { concurrency: 4 }, (s, item) => { s.exec(`echo ${item}`); })
      .build();
    expect((steps[0] as any).maxConcurrency).toBe(4);
  });

  it("when adds a Conditional step with then branch", () => {
    const steps = new SandboxStepBuilder()
      .when({ op: "eq", field: "exitCode", value: 0 }, (s) => { s.exec("echo ok"); })
      .build();
    expect(steps[0]).toMatchObject({ type: StepType.Conditional });
    expect((steps[0] as any).then).toEqual([{ type: StepType.ExecCommand, command: "echo ok" }]);
    expect((steps[0] as any).else).toBeUndefined();
  });

  it("when adds an else branch when provided", () => {
    const steps = new SandboxStepBuilder()
      .when(
        { op: "eq", field: "x", value: 1 },
        (s) => { s.exec("echo yes"); },
        (s) => { s.exec("echo no"); },
      )
      .build();
    expect((steps[0] as any).else).toEqual([{ type: StepType.ExecCommand, command: "echo no" }]);
  });

  it("parallel adds a Parallel step with branches", () => {
    const steps = new SandboxStepBuilder()
      .parallel((p) => {
        p.branch((b) => { b.exec("lint"); });
        p.branch((b) => { b.exec("test"); });
      })
      .build();
    expect(steps[0]).toMatchObject({ type: StepType.Parallel });
    expect((steps[0] as any).steps).toHaveLength(2);
  });

  it("parallel sets maxConcurrency when provided", () => {
    const steps = new SandboxStepBuilder()
      .parallel((p) => { p.branch((b) => { b.exec("a"); }); }, { concurrency: 2 })
      .build();
    expect((steps[0] as any).maxConcurrency).toBe(2);
  });

  it("chains non-output methods in order", () => {
    const steps = new SandboxStepBuilder()
      .exec("step1")
      .writeFile("/tmp/f", "x")
      .exec("step3")
      .build();
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ command: "step1" });
    expect(steps[2]).toMatchObject({ command: "step3" });
  });

  it("deleteFile produces a DeleteFile step", () => {
    const [step] = new SandboxStepBuilder().deleteFile("/tmp/build.log").build();
    expect(step).toEqual({ type: StepType.DeleteFile, path: "/tmp/build.log" });
  });

  it("moveFile produces a MoveFile step", () => {
    const [step] = new SandboxStepBuilder().moveFile("/app/dist", "/app/release").build();
    expect(step).toEqual({ type: StepType.MoveFile, from: "/app/dist", to: "/app/release" });
  });

  it("listDirectory returns a Ref and produces a ListDirectory step", () => {
    const s = new SandboxStepBuilder();
    const entries = s.listDirectory("/app", { depth: 2 });
    expect(entries).toBeInstanceOf(Ref);
    expect(s.build()[0]).toEqual({ type: StepType.ListDirectory, path: "/app", as: entries.key, depth: 2 });
  });

  it("listDirectory omits depth when not provided", () => {
    const s = new SandboxStepBuilder();
    const entries = s.listDirectory("/app");
    expect((s.build()[0] as any).depth).toBeUndefined();
    expect((s.build()[0] as any).as).toBe(entries.key);
  });

  it("searchFiles returns a Ref and produces a SearchFiles step", () => {
    const s = new SandboxStepBuilder();
    const files = s.searchFiles("**/*.ts", { dir: "/src" });
    expect(files).toBeInstanceOf(Ref);
    expect(s.build()[0]).toEqual({ type: StepType.SearchFiles, pattern: "**/*.ts", as: files.key, dir: "/src" });
  });

  it("searchFiles omits dir when not provided", () => {
    const s = new SandboxStepBuilder();
    const files = s.searchFiles("*.ts");
    expect((s.build()[0] as any).dir).toBeUndefined();
    expect((s.build()[0] as any).as).toBe(files.key);
  });

  it("createDirectory produces a CreateDirectory step", () => {
    const [step] = new SandboxStepBuilder().createDirectory("/app/logs").build();
    expect(step).toEqual({ type: StepType.CreateDirectory, path: "/app/logs" });
  });

  it("deleteDirectory produces a DeleteDirectory step", () => {
    const [step] = new SandboxStepBuilder().deleteDirectory("/app/dist").build();
    expect(step).toEqual({ type: StepType.DeleteDirectory, path: "/app/dist" });
  });

  it("setPermissions produces a SetPermissions step", () => {
    const [step] = new SandboxStepBuilder().setPermissions("/app/run.sh", "755").build();
    expect(step).toEqual({ type: StepType.SetPermissions, path: "/app/run.sh", mode: "755" });
  });

  it("replaceInFiles passes replacements through unchanged", () => {
    const [step] = new SandboxStepBuilder()
      .replaceInFiles([{ path: "/a.txt", old: "foo", new: "bar" }])
      .build();
    expect((step as any).replacements).toEqual([{ path: "/a.txt", old: "foo", new: "bar" }]);
  });

  it("replaceInFiles accepts Ref values via template literals", () => {
    const s = new SandboxStepBuilder();
    const sha = s.exec("git rev-parse HEAD", { capture: true });
    s.replaceInFiles([{ path: "/ver.txt", old: "0.0.0", new: `${sha}` }]);
    expect((s.build()[1] as any).replacements[0].new).toBe(`{{${sha.key}}}`);
  });

  it("getFileInfo returns a Ref and produces a GetFileInfo step", () => {
    const s = new SandboxStepBuilder();
    const info = s.getFileInfo("/app/bundle.js");
    expect(info).toBeInstanceOf(Ref);
    expect(s.build()[0]).toEqual({ type: StepType.GetFileInfo, path: "/app/bundle.js", as: info.key });
  });
});

// ── WorkflowBuilder ──────────────────────────────────────────────────────────

describe("workflow builder", () => {
  it("sandbox with opts prepends a CreateSandbox step", () => {
    const { steps } = workflow("test")
      .sandbox({ image: { uri: "node:20-slim" } }, (s) => { s.exec("npm test"); })
      .build();

    expect(steps[0]).toMatchObject({ type: StepType.CreateSandbox, image: { uri: "node:20-slim" } });
    expect(steps[0]).toMatchObject({ entrypoint: ["tail", "-f", "/dev/null"] });
    expect(steps[1]).toEqual({ type: StepType.ExecCommand, command: "npm test" });
  });

  it("sandbox with existing Sandbox object skips CreateSandbox and sets initialState", () => {
    const { steps, initialState } = workflow("test")
      .sandbox({ id: "sb-123", status: "running" } as any, (s) => { s.exec("ls"); })
      .build();

    expect(steps[0]).toEqual({ type: StepType.ExecCommand, command: "ls" });
    expect(initialState.sandboxId).toBe("sb-123");
  });

  it("parallel adds a Parallel step", () => {
    const { steps } = workflow("test")
      .parallel((p) => {
        p.sandbox({ image: { uri: "node:20" } }, (s) => { s.exec("lint"); });
        p.sandbox({ image: { uri: "node:20" } }, (s) => { s.exec("test"); });
      })
      .build();

    expect(steps[0]).toMatchObject({ type: StepType.Parallel });
    expect((steps[0] as any).steps).toHaveLength(2);
  });

  it("parallel forwards concurrency option", () => {
    const { steps } = workflow("test")
      .parallel(
        (p) => { p.sandbox({ image: { uri: "node:20" } }, (s) => { s.exec("a"); }); },
        { concurrency: 3 },
      )
      .build();

    expect((steps[0] as any).maxConcurrency).toBe(3);
  });

  it("build returns the workflow name", () => {
    const { name } = workflow("my-workflow")
      .sandbox({ image: { uri: "alpine" } }, (s) => { s.exec("echo hi"); })
      .build();
    expect(name).toBe("my-workflow");
  });
});
