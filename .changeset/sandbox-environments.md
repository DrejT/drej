---
"drej": minor
"@drej/sqlite": minor
"@drej/postgres": minor
---

Add sandbox environments: define a named environment with a setup recipe, build it once into a snapshot, and spawn cheap isolated sandboxes from it on demand. New API: `client.environment(name, opts)` returns an `Environment` with `.sandbox()`, `.rebuild()`, and `.info()`. `client.environments.list/delete` manage cached records. Storage adapters gain `getEnvironment`, `saveEnvironment`, `deleteEnvironment`, `listEnvironments`.
