import { describe, it, expect } from "bun:test";
import { validateAgentSpec } from "../src/schema";

describe("validateAgentSpec", () => {
  it("accepts a valid minimal spec", () => {
    const spec = validateAgentSpec({ name: "my-agent", cli: "pi" });
    expect(spec.name).toBe("my-agent");
    expect(spec.cli).toBe("pi");
  });

  it("accepts all optional fields", () => {
    const spec = validateAgentSpec({
      name: "full-agent",
      cli: "pi",
      cliVersion: "latest",
      title: "Full Agent",
      description: "An agent with all fields",
      author: "alice",
      categories: ["dev", "review"],
      packages: ["nodejs_22", "git", "ripgrep"],
      env: { ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}" },
      resources: { cpu: "1000m", memory: "2Gi" },
      metadata: { team: "infra" },
      registryDependencies: ["https://example.com/base.json"],
    });
    expect(spec.title).toBe("Full Agent");
    expect(spec.packages).toEqual(["nodejs_22", "git", "ripgrep"]);
    expect(spec.registryDependencies).toEqual(["https://example.com/base.json"]);
    expect(spec.env).toEqual({ ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}" });
  });

  it("throws when name is missing", () => {
    expect(() => validateAgentSpec({ cli: "pi" })).toThrow(/name/);
  });

  it("throws when cli is missing", () => {
    expect(() => validateAgentSpec({ name: "my-agent" })).toThrow(/pi/);
  });

  it("throws for unsupported cli value", () => {
    expect(() => validateAgentSpec({ name: "x", cli: "docker" })).toThrow(/Unsupported CLI/);
  });

  it("throws for null", () => {
    expect(() => validateAgentSpec(null)).toThrow();
  });

  it("throws for non-object types", () => {
    expect(() => validateAgentSpec("string")).toThrow();
    expect(() => validateAgentSpec(42)).toThrow();
    expect(() => validateAgentSpec([])).toThrow();
  });

  it("accepts a valid spawnDepth", () => {
    const spec = validateAgentSpec({ name: "master", cli: "pi", spawnDepth: 1 });
    expect(spec.spawnDepth).toBe(1);
  });

  it("accepts spawnDepth of 0", () => {
    const spec = validateAgentSpec({ name: "worker", cli: "pi", spawnDepth: 0 });
    expect(spec.spawnDepth).toBe(0);
  });

  it("omits spawnDepth when not set", () => {
    const spec = validateAgentSpec({ name: "plain", cli: "pi" });
    expect(spec.spawnDepth).toBeUndefined();
  });

  it("throws for a negative spawnDepth", () => {
    expect(() => validateAgentSpec({ name: "x", cli: "pi", spawnDepth: -1 })).toThrow(/spawnDepth/);
  });

  it("throws for a non-integer spawnDepth", () => {
    expect(() => validateAgentSpec({ name: "x", cli: "pi", spawnDepth: 1.5 })).toThrow(
      /spawnDepth/,
    );
  });

  it("throws for a non-numeric spawnDepth", () => {
    expect(() => validateAgentSpec({ name: "x", cli: "pi", spawnDepth: "1" })).toThrow(
      /spawnDepth/,
    );
  });
});
