import { describe, it, expect } from "bun:test";
import type { Sandbox } from "@drej/core";
import { PiAdapter } from "../src/adapters/pi";
import type { AgentSpec } from "../src/schema";

function fakeSandbox() {
  const commands: string[] = [];
  const sb = {
    exec: (cmd: string) => {
      commands.push(cmd);
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    },
  } as unknown as Sandbox;
  return { sb, commands };
}

function baseSpec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return { name: "test-agent", cli: "pi", ...overrides };
}

describe("PiAdapter.install", () => {
  it("installs the bare package when cliVersion is omitted", async () => {
    const { sb, commands } = fakeSandbox();
    await new PiAdapter().install(sb, baseSpec());
    expect(commands).toContain("npm install -g --ignore-scripts @earendil-works/pi-coding-agent");
  });

  it("pins an exact version", async () => {
    const { sb, commands } = fakeSandbox();
    await new PiAdapter().install(sb, baseSpec({ cliVersion: "1.2.3" }));
    expect(commands).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.2.3",
    );
  });

  it("passes through a semver range", async () => {
    const { sb, commands } = fakeSandbox();
    await new PiAdapter().install(sb, baseSpec({ cliVersion: "^1.2.0" }));
    expect(commands).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@^1.2.0",
    );
  });

  it("passes through a dist-tag", async () => {
    const { sb, commands } = fakeSandbox();
    await new PiAdapter().install(sb, baseSpec({ cliVersion: "latest" }));
    expect(commands).toContain(
      "npm install -g --ignore-scripts @earendil-works/pi-coding-agent@latest",
    );
  });
});
