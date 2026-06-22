# drej

Run multi-step workflows inside isolated sandbox containers. Durable, streaming, typed.

```ts
import { Drej, workflow } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: "http://localhost:8080",
  adapter: new SQLiteAdapter("./drej.db"),
});
await client.connect();

await client.run(
  workflow("hello").sandbox(
    { image: { uri: "ubuntu:22.04" } },
    (s) => s.exec('echo "hello from a sandbox"'),
  ),
).pipe(process.stdout);

await client.close();
```

---

## What it is

drej is a TypeScript SDK for orchestrating workflows that run inside isolated [OpenSandbox](https://opensandbox.ai) containers. You define steps with a fluent builder, call `client.run()`, and stream events back in real-time — no separate server, no daemon, no queue to operate.

It is designed for AI products that need to execute untrusted or generated code safely: agent tool calls, code interpreter loops, sandboxed CI pipelines, or any multi-step job that touches a filesystem and runs shell commands.

**Not a general job queue.** drej doesn't schedule work across machines — it runs workflows in-process against an OpenSandbox instance you control.

---

## Features

- **Streaming** — pipe stdout with `run.pipe(writable)`, iterate chunks with `run.stdout()`, or drain with `run.result()`
- **Durable** — every event is written to a ledger; interrupted runs resume from the last checkpoint
- **Per-step timeouts** — `exec("cmd", { timeoutMs: 30_000 })` throws `StepTimeoutError` on breach
- **Cancellation** — `run.cancel()` or `break` from the loop stops the run cleanly; external `AbortSignal` supported
- **File operations** — read, write, move, delete, search, list, patch, set permissions
- **Capture & interpolate** — `exec({ capture: true })` and `readFile()` return a `Ref<T>` that interpolates into later steps via template literals
- **Control flow** — `retry`, `when`, `forEach`, `parallel` as first-class builder methods
- **Snapshot replay** — snapshot a sandbox mid-run and replay from it later, skipping expensive setup steps
- **Saga rollback** — when a step fails, completed steps run their rollback handlers in reverse
- **OpenTelemetry** — plug in `otelHooks(tracer)` for distributed traces across every step

---

## Installation

```bash
bun add drej @drej/sqlite
```

For production, swap the SQLite adapter for Postgres:

```bash
bun add drej @drej/postgres
```

| Package | Description |
|---|---|
| `drej` | TypeScript SDK — `Drej`, `workflow()`, builder |
| `@drej/sqlite` | SQLite storage adapter (local dev, zero infra) |
| `@drej/postgres` | Postgres storage adapter (production) |
| `@drej/otel` | OpenTelemetry hooks adapter |
| `@drej/core` | Core engine — consumed by `drej`, not used directly |

---

## Quickstart

### Capture output and use it in later steps

`exec({ capture: true })` and `readFile()` return a `Ref<string>` that interpolates into template literals at runtime. Use `run.result()` to drain the run and read captured values from the final state.

```ts
let versionKey: string;

const { output, state } = await client.run(
  workflow("build").sandbox(
    { image: { uri: "node:20-slim" }, resourceLimits: { cpu: "1", memory: "512Mi" } },
    (s) => {
      const version = s.exec("node -e 'process.stdout.write(process.version)'", { capture: true });
      versionKey = version.key;
      s.exec(`echo "Running on Node ${version}"`);
      s.exec("node --check index.js", { strict: true, timeoutMs: 30_000 });
    },
  ),
).result();

console.log(output);              // all stdout
console.log(state[versionKey!]); // "v20.x.x"
```

### Read and patch files

```ts
await client.run(
  workflow("release").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "500m", memory: "256Mi" } },
    (s) => {
      s.writeFile("/app/version.txt", "1.0.0");

      const before = s.readFile("/app/version.txt");
      s.exec(`echo "before: ${before}"`);

      s.replaceInFiles([{ path: "/app/version.txt", old: "1.0.0", new: "2.0.0" }]);

      const after = s.readFile("/app/version.txt");
      s.exec(`echo "after: ${after}"`);
    },
  ),
).pipe(process.stdout);
```

### Control flow

```ts
await client.run(
  workflow("ci").sandbox(
    { image: { uri: "ubuntu:22.04" }, resourceLimits: { cpu: "1", memory: "512Mi" } },
    (s) => {
      s.retry(3, (r) => { r.exec("flaky-network-call"); }, { delayMs: 500, backoff: "exponential" });

      s.exec("test -f /app/build.sh");
      s.when(
        { op: "eq", field: "exitCode", value: 0 },
        (s) => s.exec("bash /app/build.sh"),
        (s) => s.exec("echo 'no build script'"),
      );

      const tsFiles = s.searchFiles("*.ts", { dir: "/app/src" });
      s.forEach(tsFiles, (s, file) => {
        s.exec(`tsc --noEmit ${file}`);
      });

      s.parallel((p) => {
        p.branch((b) => b.exec("npm run lint"));
        p.branch((b) => b.exec("npm run test"));
      });
    },
  ),
).pipe(process.stdout);
```

### Timeouts and cancellation

```ts
// per-step timeout
s.exec("slow-build", { timeoutMs: 60_000 });

// global default for every step in this run
const run = await client.run(wf, { stepTimeoutMs: 30_000 });

// cancel from outside
run.cancel(); // no error thrown, run.status → "cancelled"

// or break from the loop — same effect
for await (const ev of run) {
  if (someCondition) break;
}

// external AbortSignal
await client.run(wf, { signal: AbortSignal.timeout(10_000) }).pipe(process.stdout);
```

### Resume an interrupted run

```ts
const run = await client.resumeRun("build", previousRunId, wf);
await run.pipe(process.stdout);
```

---

## Local OpenSandbox setup

drej requires a running [OpenSandbox](https://opensandbox.ai) instance. For local development:

```bash
uvx opensandbox-server
```

With `~/.sandbox.toml`:

```toml
[server]
host = "127.0.0.1"
port = 8080

[runtime]
type = "docker"
execd_image = "opensandbox/execd:v1.0.19"

[docker]
network_mode = "bridge"

[ingress]
mode = "direct"

[egress]
mode = "dns"
```

---

## License

MIT
