# @drej/postgres

Postgres storage adapter for [drej](https://drej.dev). Stores the sandbox ledger in a Postgres database — suitable for production deployments where multiple processes or machines share the same ledger.

```bash
bun add @drej/postgres
```

For local development, [`@drej/sqlite`](https://github.com/DrejT/drej/tree/main/packages/adapters/sqlite) is simpler and requires no infrastructure.

---

## Usage

```ts
import { Drej } from "drej";
import { PostgresAdapter } from "@drej/postgres";

const client = new Drej({
  baseUrl: "http://localhost:8080",
  adapter: new PostgresAdapter("postgresql://user:pass@localhost:5432/drej"),
});
```

The adapter initialises lazily on first use and runs idempotent migrations (`CREATE TABLE IF NOT EXISTS`) on startup — no separate migration step needed.

---

## License

Apache 2.0
