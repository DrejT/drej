# drej

Sandboxes as objects. Spawn live containers, run code, checkpoint state — from TypeScript.

```ts
import { Drej } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: "http://localhost:8080",
  adapter: new SQLiteAdapter("./ledger.db"),
});

const sb = await client.sandbox({ image: "ubuntu:22.04", resources: { cpu: "500m", memory: "512Mi" } });
await sb.exec('echo "hello from a sandbox"').pipe(process.stdout);
await sb.close();
```

**[Full documentation →](https://docs.drej.dev)**

---

## Packages

| Package | Description |
|---|---|
| [`drej`](packages/sdks/typescript) | Core SDK — `Drej` client, `Sandbox`, `ExecHandle` |
| [`@drej/workflow`](packages/workflow) | Lazy pipeline builder — retry, branching, fan-out, parallel |
| [`@drej/agent`](packages/agent) | Run Pi coding agents in sandbox containers |
| [`@drej/sqlite`](packages/adapters/sqlite) | SQLite storage adapter (local dev, zero infra) |
| [`@drej/postgres`](packages/adapters/postgres) | Postgres storage adapter (production) |
| [`@drej/otel`](packages/adapters/otel) | OpenTelemetry hooks adapter |
| [`drejx`](packages/cli) | CLI — `drejx init`, `drejx add`, sandbox management |

---

## Local setup

drej runs sandboxes against an [OpenSandbox](https://open-sandbox.ai) instance. The fastest way to get one locally:

```bash
bunx drejx init
```

Or run the server directly with `uvx opensandbox-server` — see [`drejx`](packages/cli) for details.

---

## License

Apache 2.0
