---
"drej": minor
---

Remove the HTTP API layer. `DrejClient` now runs workflows in-process directly against OpenSandbox — no separate `drej` server required.

**Breaking change:** `DrejClientOptions.baseUrl` now points at your OpenSandbox server (e.g. `http://localhost:8080`), not the drej API. Add `apiKey` for your OpenSandbox API key.

```ts
// Before
const client = new DrejClient({ baseUrl: "http://localhost:6000" });

// After
const client = new DrejClient({ baseUrl: "http://localhost:8080", apiKey: "" });
```

All workflow execution (`run`, `replayFromSnapshot`, `resumeRun`), sandbox management, and snapshot management methods are unchanged. Add `ledgerDir` to persist the run ledger to disk across restarts.
