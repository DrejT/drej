---
"@drej/opensandbox": patch
---

Fix `ControlClient.listSandboxes()` and `listSnapshots()` returning the raw `{ items: [...] }` pagination envelope instead of a bare array — the declared return type was `Sandbox[]`/`Snapshot[]` but the methods never unwrapped `.items`, so `result.length` was `undefined` and array methods threw. Neither method had a caller anywhere else in the codebase, so this was previously untested dead code; surfaced by `examples/pi-agent/test-spawn-child.ts`, which uses `listSandboxes()` directly against the live OpenSandbox API.
