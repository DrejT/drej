import { describe, it, expect } from "bun:test";
import { resolveParentSpawnDepth } from "../src/agent";

describe("resolveParentSpawnDepth", () => {
  it("accepts a positive integer from the env value", () => {
    expect(resolveParentSpawnDepth("2")).toBe(2);
  });

  it("decrements naturally at the call site — returns the parent's own depth, not pre-decremented", () => {
    expect(resolveParentSpawnDepth("1")).toBe(1);
  });

  it("an override wins over the env value", () => {
    expect(resolveParentSpawnDepth("1", 3)).toBe(3);
  });

  it("refuses when the env value is undefined", () => {
    expect(() => resolveParentSpawnDepth(undefined)).toThrow(/positive integer/);
  });

  it("refuses when the env value is exactly 0 — no budget left", () => {
    expect(() => resolveParentSpawnDepth("0")).toThrow(/positive integer/);
  });

  it("refuses a negative env value", () => {
    expect(() => resolveParentSpawnDepth("-1")).toThrow(/positive integer/);
  });

  it("refuses a non-numeric env value", () => {
    expect(() => resolveParentSpawnDepth("not-a-number")).toThrow(/positive integer/);
  });

  it("refuses a non-integer env value", () => {
    expect(() => resolveParentSpawnDepth("1.5")).toThrow(/positive integer/);
  });

  it("refuses an override of 0", () => {
    expect(() => resolveParentSpawnDepth("5", 0)).toThrow(/positive integer/);
  });

  it("refuses a negative override even when the env value is valid", () => {
    expect(() => resolveParentSpawnDepth("5", -1)).toThrow(/positive integer/);
  });
});
