---
"@drej/core": minor
"drej": minor
---

feat: concurrency limits

Add `maxConcurrency` to `DrejClientOptions` to cap simultaneous workflow runs — `run()` awaits a slot before starting when at capacity. Add `maxConcurrency` to `parallel` and `loop` StepDefs so branches and loop iterations are throttled via a worker-pool; the `parallel()` and `forEach()` builders expose this as an `opts.concurrency` argument.
