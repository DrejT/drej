import { describe, it, expect } from "bun:test";
import { resolveParentMaxAgents } from "../src/agent";

describe("resolveParentMaxAgents", () => {
  it("accepts a non-negative integer from the env value", () => {
    expect(resolveParentMaxAgents("2")).toBe(2);
  });

  it("accepts exactly 0 — unlike spawnDepth, resolution itself doesn't refuse at 0", () => {
    expect(resolveParentMaxAgents("0")).toBe(0);
  });

  it("an override wins over the env value", () => {
    expect(resolveParentMaxAgents("1", 3)).toBe(3);
  });

  it("returns undefined when both env value and override are unset — uncapped, not refused", () => {
    expect(resolveParentMaxAgents(undefined)).toBeUndefined();
  });

  it("refuses a negative env value", () => {
    expect(() => resolveParentMaxAgents("-1")).toThrow(/non-negative integer/);
  });

  it("refuses a non-numeric env value", () => {
    expect(() => resolveParentMaxAgents("not-a-number")).toThrow(/non-negative integer/);
  });

  it("refuses a non-integer env value", () => {
    expect(() => resolveParentMaxAgents("1.5")).toThrow(/non-negative integer/);
  });

  it("refuses a negative override even when the env value is valid", () => {
    expect(() => resolveParentMaxAgents("5", -1)).toThrow(/non-negative integer/);
  });
});
