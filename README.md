# drej

Spawn sandbox containers, run commands in them, and stream results back. Durable, typed, resumable.

```ts
import { Drej } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: "http://localhost:8080",
  adapter: new SQLiteAdapter("./ledger.db"),
});

const sb = await client.sandbox({
  image: "ubuntu:22.04",
  resources: { cpu: "500m", memory: "512Mi" },
});
await sb.exec('echo "hello from a sandbox"').pipe(process.stdout);
await sb.close();
```

---

## What it is

drej is a TypeScript SDK for running code inside isolated [OpenSandbox](https://open-sandbox.ai) containers. Spawn a sandbox, run shell commands or code, stream output, checkpoint state, and resume interrupted work — all from in-process TypeScript, with no server or daemon to operate.

It is designed for AI products that need to execute untrusted or generated code safely: agent tool calls, code interpreter loops, sandboxed CI pipelines, or any job that touches a filesystem and runs shell commands.

The optional `@drej/workflow` package adds a lazy builder for multi-step pipelines with retry, conditional branching, and fan-out — all flushed in one await.

**Not a general job queue.** drej doesn't schedule work across machines — it runs containers against an OpenSandbox instance you control.

---

## Features

- **Sandbox as object** — `client.sandbox()` returns a live `Sandbox`; call exec, file ops, and checkpoint directly on it
- **Streaming** — `sb.exec("cmd").pipe(writable)`, iterate with `sb.exec("cmd").stdout()`, or await for `{ stdout, stderr, exitCode }`
- **Code execution** — `sb.execCode(code, { context })` runs Python, JS, or TS; stateful sessions persist across calls
- **Durable** — every event written to a ledger; `client.resume(sandboxId)` restores the container and replays cached exec results from before the last checkpoint
- **File operations** — read, write, delete, move, list directory, search by glob
- **Concurrency cap** — `maxConcurrency` limits simultaneous active sandboxes; `client.sandbox()` awaits a slot
- **Sandbox history** — `client.sandboxes.list()`, `.get()`, `.delete()` for audit and cleanup
- **Workflow builder** — `@drej/workflow` adds retry, when, forEach, parallel, and sequence over sandboxes
- **OpenTelemetry** — `otelHooks(tracer)` from `@drej/otel` emits distributed traces per exec and checkpoint

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
| `drej` | TypeScript SDK — `Drej` client, `Sandbox`, `ExecHandle` |
| `@drej/workflow` | Workflow builder — lazy pipeline with retry, branching, fan-out |
| `@drej/sqlite` | SQLite storage adapter (local dev, zero infra) |
| `@drej/postgres` | Postgres storage adapter (production) |
| `@drej/otel` | OpenTelemetry hooks adapter |
| `@drej/flue` | Flue sandbox adapter — use drej sandboxes as Flue session environments |
| `@drej/core` | Core engine — consumed by `drej`, not used directly |

---

## Quickstart

### Run a command and read output

```ts
import { Drej } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: "http://localhost:8080",
  adapter: new SQLiteAdapter("./drej.db"),
});

const sb = await client.sandbox({
  image: "ubuntu:22.04",
  resources: { cpu: "500m", memory: "512Mi" },
});

// Await result
const { stdout, exitCode } = await sb.exec("node --version");

// Stream to writable
await sb.exec("npm run build").pipe(process.stdout);

// Async iteration
for await (const chunk of sb.exec("npm test").stdout()) {
  process.stdout.write(chunk);
}

await sb.close();
```

### File operations

```ts
await sb.writeFile("/app/main.py", "print('hello')");

const content = await sb.readFile("/app/main.py");

const files = await sb.searchFiles("*.py", "/app");
await sb.moveFile("/tmp/out.txt", "/app/out.txt");
await sb.deleteFile("/app/main.py");
```

### Execute code directly

`execCode` runs Python, JavaScript, or TypeScript via the sandbox's built-in interpreter. Pass a `context` to share state across calls within the same session.

```ts
import { CodeLanguage } from "@drej/opensandbox";

const ctx = { id: "my-session", language: CodeLanguage.Python };

await sb.execCode("x = 42", { context: ctx });
await sb.execCode("print(x)", { context: ctx }).pipe(process.stdout); // prints 42
```

### Checkpoint and resume

```ts
const sb = await client.sandbox({
  image: "ubuntu:22.04",
  name: "my-run",
  resources: { cpu: "500m", memory: "512Mi" },
});

await sb.exec("apt-get install -y curl");
await sb.checkpoint("after-setup");
await sb.close();

// Later — or after a crash
const sbRestored = await client.resume(sb.sandboxId);
// Execs before the checkpoint replay from the ledger cache.
// New execs run live against the restored container.
await sbRestored.exec("curl https://example.com").pipe(process.stdout);
await sbRestored.close();
```

### Error handling

```ts
import { CommandError, SandboxError, ExecConnectionError } from "drej";

// strict: true is the default — non-zero exit throws CommandError
try {
  await sb.exec("exit 1");
} catch (e) {
  if (e instanceof CommandError) {
    console.log(e.exitCode, e.command);
  }
}

// Opt out to handle non-zero exits manually
const { exitCode } = await sb.exec("exit 1", { strict: false });
```

---

## Workflow builder

`@drej/workflow` provides a lazy builder for multi-step pipelines. All methods queue operations synchronously; the pipeline executes when you await `.pipe()` or `.result()`.

```bash
bun add @drej/workflow
```

```ts
import { workflow } from "@drej/workflow";

await workflow(client)
  .sandbox(
    { image: "node:20-slim", resources: { cpu: "1", memory: "512Mi" } },
    (sb) => {
      sb.exec("npm ci");
      sb.exec("npm run build");
      sb.exec("npm test");
    },
  )
  .pipe(process.stdout);
```

### Retry

```ts
sb.retry(3, (r) => {
  r.exec("flaky-network-call");
}, { delayMs: 500, backoff: "exponential" });
```

### Conditional branching

The predicate receives `{ stdout, exitCode, vars }` from the previous step.

```ts
sb.exec("test -f /app/build.sh", { strict: false });
sb.when(
  (ctx) => ctx.exitCode === 0,
  (s) => s.exec("bash /app/build.sh"),
  (s) => s.exec("echo 'no build script'"),
);
```

### Fan-out

```ts
sb.forEach(["a.ts", "b.ts", "c.ts"], (s, file) => {
  s.exec(`tsc --noEmit ${file}`);
}, { concurrency: 4 });
```

### Capture a file into the result

`sb.readFile(path, as)` in the builder stores the file contents in `vars[as]` on the result object.

```ts
const { vars } = await workflow(client)
  .sandbox({ image: "node:20-slim" }, (sb) => {
    sb.exec("node -e \"require('fs').writeFileSync('/out.txt', process.version)\"");
    sb.readFile("/out.txt", "nodeVersion");
  })
  .result();

console.log(vars.nodeVersion); // "v20.x.x"
```

### Parallel sandboxes

Run the same builder across multiple sandbox configs simultaneously:

```ts
await workflow(client)
  .parallel(
    [
      { image: "node:18-slim" },
      { image: "node:20-slim" },
      { image: "node:22-slim" },
    ],
    (sb) => {
      sb.exec("node --version");
      sb.exec("npm ci && npm test");
    },
  )
  .pipe(process.stdout);
```

### Sequential pipeline

```ts
await workflow(client)
  .sequence([
    { image: "node:20-slim", resources: { cpu: "1", memory: "512Mi" }, run: (sb) => { sb.exec("npm ci"); sb.exec("npm run build"); } },
    { image: "alpine:3",     resources: { cpu: "500m", memory: "256Mi" }, run: (sb) => { sb.exec("ls /app/dist"); } },
  ])
  .pipe(process.stdout);
```

---

## OpenTelemetry

```ts
import { otelHooks } from "@drej/otel";

const sb = await client.sandbox({
  image: "ubuntu:22.04",
  hooks: otelHooks(tracer),
});
// Emits: sandbox.run → sandbox.exec (per command), sandbox.checkpoint
```

---

## Local OpenSandbox setup

drej requires a running [OpenSandbox](https://open-sandbox.ai) instance. For local development:

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

Apache 2.0
