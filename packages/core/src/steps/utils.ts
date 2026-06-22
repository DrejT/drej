import type { Predicate, WorkflowState } from "./types";

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

export function interpolate(template: string, state: WorkflowState): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const val = getPath(state, key);
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

export function evaluate(predicate: Predicate, state: unknown): boolean {
  switch (predicate.op) {
    case "eq":        return getPath(state, predicate.field) === predicate.value;
    case "neq":       return getPath(state, predicate.field) !== predicate.value;
    case "gt":        return Number(getPath(state, predicate.field)) > predicate.value;
    case "lt":        return Number(getPath(state, predicate.field)) < predicate.value;
    case "gte":       return Number(getPath(state, predicate.field)) >= predicate.value;
    case "lte":       return Number(getPath(state, predicate.field)) <= predicate.value;
    case "exists":     return getPath(state, predicate.field) !== undefined;
    case "not_exists": return getPath(state, predicate.field) === undefined;
    case "and":       return predicate.predicates.every((p) => evaluate(p, state));
    case "or":        return predicate.predicates.some((p) => evaluate(p, state));
  }
}

export async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, max: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(max, tasks.length) }, worker));
  return results;
}
