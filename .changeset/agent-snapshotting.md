---
"@drej/agent": minor
"@drej/core": minor
"drej": minor
---

Agent snapshotting: `Agent.load()` checkpoints the sandbox after Pi install and restores from the snapshot on subsequent loads, reducing startup from ~90s to ~8s. `checkpoint()` now returns the snapshot ID. New `Drej.restoreSnapshot(snapshotId, name, resources)` creates a sandbox from a snapshot without exec replay. `Agent.load()` accepts `{ rebuild: true }` to force reinstall.
