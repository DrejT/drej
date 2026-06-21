---
"drej": minor
"@drejt/core": minor
---

Make sandbox lifecycle explicit — no more implicit deletion

Previously `workflow().sandbox(opts, fn)` automatically deleted the sandbox
at the end of the workflow and on rollback. Sandbox lifecycle is now the
caller's responsibility.

**What changed:**

- `sandbox()` no longer appends a `delete_sandbox` step or rolls back on failure
- `sandbox()` now accepts an existing `Sandbox` object in place of `SandboxOpts`,
  letting you pass a sandbox you created and manage yourself
- Call `client.deleteSandbox(id)` explicitly when you are done with a sandbox

```ts
// Create a fresh sandbox — stays alive after the workflow
const run = await client.run(
  workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
    s.exec("npm ci").exec("npm test"),
  ),
);
for await (const ev of run) { ... }
await client.deleteSandbox(run.sandboxId); // explicit cleanup

// Or manage the sandbox yourself
const sb = await client.createSandbox({ image: { uri: "node:20-slim" } });
await client.run(workflow("build").sandbox(sb, (s) => s.exec("npm test")));
await client.run(workflow("lint").sandbox(sb, (s) => s.exec("npm run lint")));
await client.deleteSandbox(sb.id);
```
