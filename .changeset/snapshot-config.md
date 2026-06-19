---
"drej": minor
---

Add `snapshotConfig` option to `client.run()` and a `replayFromSnapshot()` method.

Pass `snapshotConfig: { afterSteps?: number[]; everyNSteps?: number }` to capture sandbox snapshots at specific points in a workflow. Call `client.replayFromSnapshot(name, runId, workflow)` to start a new run booted from the latest captured snapshot — skipping any setup steps already baked into the image.
