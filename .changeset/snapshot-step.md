---
"drej": minor
"@drejt/core": minor
---

Add `s.snapshot()` as a first-class workflow step

Previously, capturing a sandbox snapshot required passing `snapshotConfig: { afterSteps: [N] }` to `client.run()` — which meant counting step indices upfront and re-counting whenever steps were reordered.

`s.snapshot()` declares the checkpoint inline, where it belongs:

```ts
workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
  s.exec("npm ci")
   .snapshot()      // checkpoint: deps installed
   .exec("npm test"),
)
```

The snapshot ID is persisted to the ledger and stored in workflow state as `snapshotId`. `client.replayFromSnapshot()` works the same way regardless of which method was used to take the snapshot.

`snapshotConfig` on `client.run()` remains supported — it is useful when you need to snapshot a workflow you didn't write, or snapshot on a cadence (`everyNSteps`) rather than at a fixed point.
