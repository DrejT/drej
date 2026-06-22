import { describe, expect, it } from "vitest";
import { evaluate, getPath, interpolate, runWithConcurrency } from "../src/steps/utils.ts";

describe("getPath", () => {
  it("returns a top-level value", () => {
    expect(getPath({ a: 1 }, "a")).toBe(1);
  });

  it("traverses nested paths", () => {
    expect(getPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("returns undefined for missing keys", () => {
    expect(getPath({ a: 1 }, "b")).toBeUndefined();
  });

  it("returns undefined when traversing through a non-object", () => {
    expect(getPath({ a: null }, "a.b")).toBeUndefined();
  });
});

describe("interpolate", () => {
  it("replaces a known key", () => {
    expect(interpolate("hello {{name}}", { name: "world" })).toBe("hello world");
  });

  it("leaves unknown keys as-is", () => {
    expect(interpolate("hello {{missing}}", {})).toBe("hello {{missing}}");
  });

  it("replaces multiple occurrences", () => {
    expect(interpolate("{{a}} and {{b}}", { a: "foo", b: "bar" })).toBe("foo and bar");
  });

  it("coerces non-string values to string", () => {
    expect(interpolate("count: {{n}}", { n: 42 })).toBe("count: 42");
  });

  it("resolves dotted paths into nested state", () => {
    expect(interpolate("path: {{item.path}}", { item: { path: "/app/foo.ts" } })).toBe("path: /app/foo.ts");
  });

  it("leaves unresolved dotted keys as-is", () => {
    expect(interpolate("{{item.missing}}", { item: {} })).toBe("{{item.missing}}");
  });
});

describe("evaluate", () => {
  it("eq matches equal values", () => {
    expect(evaluate({ op: "eq", field: "x", value: 1 }, { x: 1 })).toBe(true);
    expect(evaluate({ op: "eq", field: "x", value: 1 }, { x: 2 })).toBe(false);
  });

  it("neq matches unequal values", () => {
    expect(evaluate({ op: "neq", field: "x", value: 1 }, { x: 2 })).toBe(true);
  });

  it("gt / lt / gte / lte do numeric comparison", () => {
    expect(evaluate({ op: "gt", field: "n", value: 5 }, { n: 6 })).toBe(true);
    expect(evaluate({ op: "lt", field: "n", value: 5 }, { n: 4 })).toBe(true);
    expect(evaluate({ op: "gte", field: "n", value: 5 }, { n: 5 })).toBe(true);
    expect(evaluate({ op: "lte", field: "n", value: 5 }, { n: 5 })).toBe(true);
  });

  it("exists / not_exists check presence", () => {
    expect(evaluate({ op: "exists", field: "x" }, { x: 0 })).toBe(true);
    expect(evaluate({ op: "exists", field: "x" }, {})).toBe(false);
    expect(evaluate({ op: "not_exists", field: "x" }, {})).toBe(true);
  });

  it("and requires all predicates to pass", () => {
    expect(evaluate({
      op: "and",
      predicates: [
        { op: "eq", field: "x", value: 1 },
        { op: "eq", field: "y", value: 2 },
      ],
    }, { x: 1, y: 2 })).toBe(true);

    expect(evaluate({
      op: "and",
      predicates: [
        { op: "eq", field: "x", value: 1 },
        { op: "eq", field: "y", value: 9 },
      ],
    }, { x: 1, y: 2 })).toBe(false);
  });

  it("or passes if any predicate passes", () => {
    expect(evaluate({
      op: "or",
      predicates: [
        { op: "eq", field: "x", value: 99 },
        { op: "eq", field: "y", value: 2 },
      ],
    }, { x: 1, y: 2 })).toBe(true);
  });
});

describe("runWithConcurrency", () => {
  it("runs all tasks and returns results in order", async () => {
    const tasks = [1, 2, 3].map((n) => () => Promise.resolve(n * 10));
    expect(await runWithConcurrency(tasks, 2)).toEqual([10, 20, 30]);
  });

  it("respects concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return active;
    });
    await runWithConcurrency(tasks, 2);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("handles empty task list", async () => {
    expect(await runWithConcurrency([], 4)).toEqual([]);
  });
});
