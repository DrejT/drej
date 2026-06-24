---
"drej": minor
"@drej/sqlite": minor
"@drej/postgres": minor
---

Add named checkpoints: `sb.listCheckpoints()` returns all checkpoints in creation order with `snapshotId`, `tag`, and `createdAt`. `client.resume(id, { tag })` resumes from a specific named checkpoint instead of the most recent. New exported types: `CheckpointInfo`, `ResumeOptions`. Storage adapters gain `listCheckpoints()`.
