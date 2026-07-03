---
"@drej/core": patch
"@drej/otel": patch
"@drej/agent": patch
"drej": patch
"@drej/workflow": patch
---

Fix JSDoc comments that no longer matched the code they document (stale `DrejClient` references, incorrect claims about `DrejError`, `watchMetrics()`, `resume()`, `exec()` ledger logging, `CommandError`, `computeSetupHash`, `bash()` streaming, and the `when()` predicate context), and flag two fields (`AgentSpec.cliVersion`, `.metadata`, `.registryDependencies`) and one known concurrency limitation (`FlushContext` under `forEach({ concurrency > 1 })`) that are currently no-ops/buggy rather than doing what they were documented to do. No behavior changes — doc-only.
