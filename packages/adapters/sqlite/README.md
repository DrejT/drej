# @drej/sqlite

SQLite storage adapter for [drej](https://drej.dev). Stores the sandbox ledger in a local `.db` file — zero infrastructure, works out of the box.

```bash
bun add @drej/sqlite
```

For production workloads that need durability across multiple processes or machines, use [`@drej/postgres`](https://github.com/DrejT/drej/tree/main/packages/adapters/postgres) instead.

---

## Usage

```ts
import { Drej } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new Drej({
  baseUrl: "http://localhost:8080",
  adapter: new SQLiteAdapter("./ledger.db"),
});
```

The adapter initialises lazily on first use — no `connect()` call needed. On process exit, `beforeExit` closes the connection automatically.

WAL mode is enabled by default for better concurrent read performance.

---

## License

Apache 2.0
