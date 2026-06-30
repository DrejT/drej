import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { resolveEnv, toShellExports } from "../src/adapters/pi";

describe("resolveEnv", () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.MY_KEY = "secret-value";
    process.env.ANOTHER = "hello";
  });

  afterAll(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
  });

  it("passes through plain values unchanged", () => {
    const result = resolveEnv({ FOO: "bar", NUM: "42" });
    expect(result.FOO).toBe("bar");
    expect(result.NUM).toBe("42");
  });

  it("interpolates ${VAR} from process.env", () => {
    const result = resolveEnv({ KEY: "${MY_KEY}" });
    expect(result.KEY).toBe("secret-value");
  });

  it("interpolates multiple vars in a single value", () => {
    const result = resolveEnv({ GREETING: "${ANOTHER} world ${MY_KEY}" });
    expect(result.GREETING).toBe("hello world secret-value");
  });

  it("replaces missing vars with empty string", () => {
    const result = resolveEnv({ KEY: "${DOES_NOT_EXIST}" });
    expect(result.KEY).toBe("");
  });

  it("leaves non-interpolation curly syntax alone", () => {
    const result = resolveEnv({ KEY: "plain-value" });
    expect(result.KEY).toBe("plain-value");
  });

  it("handles empty env record", () => {
    expect(resolveEnv({})).toEqual({});
  });
});

describe("toShellExports", () => {
  it("produces export statements", () => {
    const output = toShellExports({ FOO: "bar", BAZ: "qux" });
    expect(output).toContain('export FOO="bar"');
    expect(output).toContain('export BAZ="qux"');
  });

  it("ends with a newline", () => {
    expect(toShellExports({ A: "1" }).endsWith("\n")).toBe(true);
  });

  it("escapes double quotes in values", () => {
    const output = toShellExports({ MSG: 'say "hello"' });
    expect(output).toContain('export MSG="say \\"hello\\""');
  });

  it("escapes backslashes in values", () => {
    const output = toShellExports({ PATH_EXTRA: "C:\\Users\\foo" });
    expect(output).toContain("C:\\\\Users\\\\foo");
  });

  it("handles empty env record", () => {
    expect(toShellExports({})).toBe("\n");
  });
});
