import { describe, expect, it, vi } from "vitest";
import {
  buildDeleteFileStep,
  buildListDirectoryStep,
  buildMoveFileStep,
  buildReadFileStep,
  buildSearchFilesStep,
  buildWriteFileStep,
} from "../src/steps/file.ts";
import { Encoding, StepType } from "../src/steps/types.ts";
import type { WorkflowRunContext } from "../src/workflow.ts";

function makeStream(text = ""): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
}

function makeCtx(execClient: Record<string, unknown>): WorkflowRunContext {
  return {
    workflowName: "test-wf",
    runId: "run-1",
    stepIndex: 0,
    control: {} as any,
    resolveExec: async () => execClient as any,
    emit: vi.fn().mockResolvedValue(undefined),
  };
}

// ── deleteFile ────────────────────────────────────────────────────────────────

describe("buildDeleteFileStep", () => {
  it("calls deleteFile with the given path", async () => {
    const exec = { deleteFile: vi.fn().mockResolvedValue(undefined) };
    const step = buildDeleteFileStep({ type: StepType.DeleteFile, path: "/tmp/a.txt" });
    await step.run({ sandboxId: "sb-1" }, makeCtx(exec));
    expect(exec.deleteFile).toHaveBeenCalledWith("/tmp/a.txt");
  });

  it("interpolates path against state", async () => {
    const exec = { deleteFile: vi.fn().mockResolvedValue(undefined) };
    const step = buildDeleteFileStep({ type: StepType.DeleteFile, path: "/tmp/{{sha}}.log" });
    await step.run({ sandboxId: "sb-1", sha: "abc" }, makeCtx(exec));
    expect(exec.deleteFile).toHaveBeenCalledWith("/tmp/abc.log");
  });

  it("returns state unchanged", async () => {
    const exec = { deleteFile: vi.fn().mockResolvedValue(undefined) };
    const step = buildDeleteFileStep({ type: StepType.DeleteFile, path: "/tmp/a.txt" });
    const result = await step.run({ sandboxId: "sb-1", x: 42 }, makeCtx(exec));
    expect((result as any).x).toBe(42);
  });

  it("throws when sandboxId is missing", async () => {
    const step = buildDeleteFileStep({ type: StepType.DeleteFile, path: "/tmp/a.txt" });
    await expect(step.run({}, makeCtx({}))).rejects.toThrow("sandboxId");
  });
});

// ── moveFile ──────────────────────────────────────────────────────────────────

describe("buildMoveFileStep", () => {
  it("calls moveFile with from and to", async () => {
    const exec = { moveFile: vi.fn().mockResolvedValue(undefined) };
    const step = buildMoveFileStep({ type: StepType.MoveFile, from: "/app/dist", to: "/app/release" });
    await step.run({ sandboxId: "sb-1" }, makeCtx(exec));
    expect(exec.moveFile).toHaveBeenCalledWith("/app/dist", "/app/release");
  });

  it("interpolates both from and to against state", async () => {
    const exec = { moveFile: vi.fn().mockResolvedValue(undefined) };
    const step = buildMoveFileStep({ type: StepType.MoveFile, from: "/tmp/{{ver}}", to: "/app/{{ver}}" });
    await step.run({ sandboxId: "sb-1", ver: "v2" }, makeCtx(exec));
    expect(exec.moveFile).toHaveBeenCalledWith("/tmp/v2", "/app/v2");
  });

  it("returns state unchanged", async () => {
    const exec = { moveFile: vi.fn().mockResolvedValue(undefined) };
    const step = buildMoveFileStep({ type: StepType.MoveFile, from: "/a", to: "/b" });
    const result = await step.run({ sandboxId: "sb-1", tag: "x" }, makeCtx(exec));
    expect((result as any).tag).toBe("x");
  });
});

// ── listDirectory ─────────────────────────────────────────────────────────────

describe("buildListDirectoryStep", () => {
  const entries = [
    { name: "a.txt", path: "/app/a.txt", isDirectory: false },
    { name: "src", path: "/app/src", isDirectory: true },
  ];

  it("stores entries under the given key", async () => {
    const exec = { listDirectory: vi.fn().mockResolvedValue(entries) };
    const step = buildListDirectoryStep({ type: StepType.ListDirectory, path: "/app", as: "items" });
    const result = await step.run({ sandboxId: "sb-1" }, makeCtx(exec)) as any;
    expect(result.items).toEqual(entries);
  });

  it("passes depth to listDirectory", async () => {
    const exec = { listDirectory: vi.fn().mockResolvedValue([]) };
    const step = buildListDirectoryStep({ type: StepType.ListDirectory, path: "/app", as: "items", depth: 2 });
    await step.run({ sandboxId: "sb-1" }, makeCtx(exec));
    expect(exec.listDirectory).toHaveBeenCalledWith("/app", 2);
  });

  it("passes undefined depth when not set", async () => {
    const exec = { listDirectory: vi.fn().mockResolvedValue([]) };
    const step = buildListDirectoryStep({ type: StepType.ListDirectory, path: "/app", as: "items" });
    await step.run({ sandboxId: "sb-1" }, makeCtx(exec));
    expect(exec.listDirectory).toHaveBeenCalledWith("/app", undefined);
  });

  it("interpolates path against state", async () => {
    const exec = { listDirectory: vi.fn().mockResolvedValue([]) };
    const step = buildListDirectoryStep({ type: StepType.ListDirectory, path: "/app/{{env}}", as: "items" });
    await step.run({ sandboxId: "sb-1", env: "prod" }, makeCtx(exec));
    expect(exec.listDirectory).toHaveBeenCalledWith("/app/prod", undefined);
  });

  it("preserves existing state keys", async () => {
    const exec = { listDirectory: vi.fn().mockResolvedValue(entries) };
    const step = buildListDirectoryStep({ type: StepType.ListDirectory, path: "/app", as: "items" });
    const result = await step.run({ sandboxId: "sb-1", prior: true }, makeCtx(exec)) as any;
    expect(result.prior).toBe(true);
  });
});

// ── searchFiles ───────────────────────────────────────────────────────────────

describe("buildSearchFilesStep", () => {
  it("stores matches under the given key", async () => {
    const matches = ["/app/a.ts", "/app/b.ts"];
    const exec = { searchFiles: vi.fn().mockResolvedValue(matches) };
    const step = buildSearchFilesStep({ type: StepType.SearchFiles, pattern: "**/*.ts", as: "files" });
    const result = await step.run({ sandboxId: "sb-1" }, makeCtx(exec)) as any;
    expect(result.files).toEqual(matches);
  });

  it("passes dir to searchFiles when set", async () => {
    const exec = { searchFiles: vi.fn().mockResolvedValue([]) };
    const step = buildSearchFilesStep({ type: StepType.SearchFiles, pattern: "*.ts", as: "files", dir: "/src" });
    await step.run({ sandboxId: "sb-1" }, makeCtx(exec));
    expect(exec.searchFiles).toHaveBeenCalledWith("*.ts", "/src");
  });

  it("passes undefined dir when not set", async () => {
    const exec = { searchFiles: vi.fn().mockResolvedValue([]) };
    const step = buildSearchFilesStep({ type: StepType.SearchFiles, pattern: "*.ts", as: "files" });
    await step.run({ sandboxId: "sb-1" }, makeCtx(exec));
    expect(exec.searchFiles).toHaveBeenCalledWith("*.ts", undefined);
  });

  it("interpolates pattern and dir against state", async () => {
    const exec = { searchFiles: vi.fn().mockResolvedValue([]) };
    const step = buildSearchFilesStep({ type: StepType.SearchFiles, pattern: "{{ext}}", as: "files", dir: "/{{folder}}" });
    await step.run({ sandboxId: "sb-1", ext: "*.ts", folder: "src" }, makeCtx(exec));
    expect(exec.searchFiles).toHaveBeenCalledWith("*.ts", "/src");
  });
});

// ── writeFile / readFile path interpolation ───────────────────────────────────

describe("buildWriteFileStep path + content interpolation", () => {
  it("interpolates path against state", async () => {
    const exec = { uploadFile: vi.fn().mockResolvedValue(undefined) };
    const step = buildWriteFileStep({ type: StepType.WriteFile, path: "/app/{{name}}.txt", content: "hello" });
    await step.run({ sandboxId: "sb-1", name: "config" }, makeCtx(exec));
    expect(exec.uploadFile).toHaveBeenCalledWith("/app/config.txt", expect.anything());
  });

  it("interpolates UTF8 content against state", async () => {
    const exec = { uploadFile: vi.fn().mockResolvedValue(undefined) };
    const step = buildWriteFileStep({ type: StepType.WriteFile, path: "/out.txt", content: "sha={{sha}}" });
    await step.run({ sandboxId: "sb-1", sha: "abc" }, makeCtx(exec));
    expect(exec.uploadFile).toHaveBeenCalledWith("/out.txt", "sha=abc");
  });

  it("does not interpolate base64 content", async () => {
    const exec = { uploadFile: vi.fn().mockResolvedValue(undefined) };
    const raw = Buffer.from("{{hello}}").toString("base64");
    const step = buildWriteFileStep({ type: StepType.WriteFile, path: "/out.bin", content: raw, encoding: Encoding.Base64 });
    await step.run({ sandboxId: "sb-1", hello: "world" }, makeCtx(exec));
    // base64 content is decoded to bytes, not interpolated
    const [, uploadedContent] = (exec.uploadFile.mock.calls[0] as [string, ArrayBuffer]);
    expect(uploadedContent).toBeInstanceOf(ArrayBuffer);
  });
});

describe("buildReadFileStep path interpolation", () => {
  it("interpolates path against state", async () => {
    const exec = { downloadFile: vi.fn().mockResolvedValue(makeStream("hello")) };
    const step = buildReadFileStep({ type: StepType.ReadFile, path: "/app/{{name}}.txt", as: "data" });
    await step.run({ sandboxId: "sb-1", name: "config" }, makeCtx(exec));
    expect(exec.downloadFile).toHaveBeenCalledWith("/app/config.txt");
  });

  it("stores file content under the as key", async () => {
    const exec = { downloadFile: vi.fn().mockResolvedValue(makeStream("world")) };
    const step = buildReadFileStep({ type: StepType.ReadFile, path: "/out.txt", as: "result" });
    const out = await step.run({ sandboxId: "sb-1" }, makeCtx(exec)) as any;
    expect(out.result).toBe("world");
  });
});
