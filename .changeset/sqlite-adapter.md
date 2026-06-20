---
"@drej/sqlite": minor
---

Introduce `@drej/sqlite` storage adapter.

`SQLiteAdapter` implements `IStorageAdapter` via Bun's built-in `bun:sqlite` — zero extra dependencies and no infrastructure required. Data persists across restarts, making it suitable for local development and single-process production workloads.

```ts
import { DrejClient } from "drej";
import { SQLiteAdapter } from "@drej/sqlite";

const client = new DrejClient({
  baseUrl: "http://localhost:8080",
  adapter: new SQLiteAdapter("./drej.db"),
});
await client.connect();
```

WAL mode is enabled on `connect()` for safe concurrent reads alongside ongoing writes.
