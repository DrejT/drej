# Concurrency Limits

Two independent features, each scoped to a different layer.

---

## Feature 1 — Client-level workflow concurrency

### Goal

`DrejClient` starts workflow execution immediately when `run()` is called. With no cap, 100 concurrent
callers spawn 100 sandboxes simultaneously. `maxConcurrency` gives operators a hard ceiling on
simultaneous runs.

### API surface

```ts
// DrejClientOptions (packages/sdks/typescript/src/client.ts)
export interface DrejClientOptions {
  baseUrl: string;
  apiKey?: string;
  adapter: IStorageAdapter;
  maxConcurrency?: number;   // NEW — undefined = unlimited
}
```

### Behaviour

`run()` **blocks** (awaits) if the active run count is at `maxConcurrency`. It returns only once a
slot is free and execution has started. The caller's slot is held until the `WorkflowRun`'s generator
is fully consumed (all events drained, or error thrown, or early return).

```ts
// concurrent calls when maxConcurrency = 2
const [r1, r2, r3] = await Promise.all([
  client.run(wf),  // starts immediately
  client.run(wf),  // starts immediately (slot 2)
  client.run(wf),  // awaits until r1 or r2 finishes
]);
```

### Implementation

**`DrejClient` — new fields + methods**

```ts
private readonly _maxConcurrency: number | undefined;
private _activeRuns = 0;
private readonly _waiters: Array<() => void> = [];

private async _acquireSlot(): Promise<void> {
  if (!this._maxConcurrency || this._activeRuns < this._maxConcurrency) {
    this._activeRuns++;
    return;
  }
  await new Promise<void>((resolve) => this._waiters.push(resolve));
  this._activeRuns++;
}

private _releaseSlot(): void {
  this._activeRuns--;
  const next = this._waiters.shift();
  next?.();
}

private async *_withRelease(gen: AsyncGenerator<WorkflowEvent>): AsyncGenerator<WorkflowEvent> {
  try {
    yield* gen;
  } finally {
    this._releaseSlot();
  }
}
```

**Updated `run()`**

```ts
async run(w: WorkflowBuilder, options?: RunOptions): Promise<WorkflowRun> {
  await this._acquireSlot();                          // blocks when at capacity
  const { name, steps, initialState } = w.build();
  const runId = crypto.randomUUID();
  const gen = this._execute(name, runId, steps, options, initialState);
  return new WorkflowRun(name, runId, this._withRelease(gen));
}
```

The slot is released in the `finally` block of `_withRelease`, so it fires regardless of whether the
generator completes normally, throws, or is cancelled via `return()`.

**Files changed**
- `packages/sdks/typescript/src/client.ts` — only file touched

---

## Feature 2 — Step-level concurrency (`parallel` and `loop`)

### Current state

| Step | Current behaviour |
|---|---|
| `parallel()` | `Promise.all()` — all branches run simultaneously, no cap |
| `loop` with `concurrently: true` | `Promise.all()` — all iterations at once |
| `loop` without `concurrently` | sequential |

The `forEach` builder already accepts `concurrency?: number` but ignores the actual number —
it only sets `concurrently: true` on the StepDef. Nothing limits parallelism.

### Goal

- `parallel()` accepts an optional `concurrency` option to cap simultaneous branches.
- `forEach()` / `loop` wires the `concurrency` number to actually throttle iterations.

### StepDef changes (`packages/core/src/steps.ts`)

Remove `concurrently?: boolean` from the `loop` StepDef union member. Replace with `maxConcurrency?: number`.

```ts
// BEFORE
| { type: "loop"; over?: string; items?: unknown[]; as: string; steps: StepDef[]; concurrently?: boolean }
| { type: "parallel"; steps: StepDef[] }

// AFTER
| { type: "loop"; over?: string; items?: unknown[]; as: string; steps: StepDef[]; maxConcurrency?: number }
| { type: "parallel"; steps: StepDef[]; maxConcurrency?: number }
```

`maxConcurrency` semantics:
- `undefined` — sequential (loop) or unlimited (parallel, preserving current behaviour)
- `1` — sequential
- `N > 1` — at most N tasks running at a time

### Concurrency primitive

Add a single private helper in `steps.ts`:

```ts
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  max: number,
): Promise<T[]> {
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
```

Worker-pool pattern — N workers drain the task queue in order, preserving result indices.

### Updated execution logic

**`loop` case**

```ts
case "loop": {
  // ...
  const runIteration = async (item: unknown, index: number): Promise<unknown> => { ... };

  const max = def.maxConcurrency ?? 1;
  const tasks = arr.map((item, i) => () => runIteration(item, i));
  const loopResults = max === 1
    ? await tasks.reduce<Promise<unknown[]>>(async (acc, t) => [...(await acc), await t()], Promise.resolve([]))
    : await runWithConcurrency(tasks, max);

  return { ...(input as WorkflowState), loopResults };
}
```

**`parallel` case**

```ts
case "parallel": {
  const branchedTasks = def.steps.map((stepDef, branchIndex) => {
    const branchCtx = { ...ctx, stepIndex: ctx.stepIndex * 1000 + branchIndex,
      emit: (entry) => ctx.emit({ ...entry, branch: branchIndex }) };
    return () => buildStep(stepDef).run(input, branchCtx);
  });

  const results = def.maxConcurrency
    ? await runWithConcurrency(branchedTasks, def.maxConcurrency)
    : await Promise.all(branchedTasks.map((t) => t()));

  const merged = results.reduce<WorkflowState>(
    (acc, r) => ({ ...acc, ...(r as WorkflowState) }),
    input as WorkflowState,
  );
  return { ...merged, parallelResults: results };
}
```

### Builder changes (`packages/sdks/typescript/src/workflow.ts`)

**`forEach` — wire `concurrency` through to `maxConcurrency`**

```ts
// BEFORE
...(opts.concurrency !== undefined && opts.concurrency > 1 ? { concurrently: true } : {}),

// AFTER
...(opts.concurrency !== undefined && opts.concurrency > 1 ? { maxConcurrency: opts.concurrency } : {}),
```

**`SandboxStepBuilder.parallel` — add `opts` parameter**

```ts
// BEFORE
parallel(fn: (p: SandboxParallelBuilder) => SandboxParallelBuilder): this

// AFTER
parallel(fn: (p: SandboxParallelBuilder) => SandboxParallelBuilder, opts?: { concurrency?: number }): this
// push: { type: "parallel", steps: pb.build(), ...(opts?.concurrency ? { maxConcurrency: opts.concurrency } : {}) }
```

**`WorkflowBuilder.parallel` — same addition**

```ts
parallel(fn: (p: WorkflowParallelBuilder) => WorkflowParallelBuilder, opts?: { concurrency?: number }): this
```

**Files changed**
- `packages/core/src/steps.ts` — StepDef union, `runWithConcurrency` helper, loop + parallel execution
- `packages/sdks/typescript/src/workflow.ts` — `forEach`, `SandboxStepBuilder.parallel`, `WorkflowBuilder.parallel`

---

## What is NOT changing

- `IStorageAdapter` — untouched
- `Workflow` engine (`workflow.ts`) — untouched; concurrency is entirely a step-execution concern
- `WorkflowRun.status` — untouched
- `DrejClientOptions.adapter` — untouched

---

## Changeset

Minor bump on `@drej/core` (StepDef change is a breaking type change for custom adapter authors who
pattern-match on StepDef) and `drej` (new `DrejClientOptions.maxConcurrency` field, new builder opts).
`@drej/postgres` and `@drej/sqlite` are untouched.
