---
"drej": minor
"@drejt/core": minor
---

Add `capture` option to `exec()` for storing stdout in workflow state

Pass `{ capture: "key" }` to store a command's stdout under that key in
workflow state. The value is immediately available for interpolation in
subsequent steps via `{{key}}`, or accessible on `WorkflowState` after
the run. Trailing newlines are trimmed.

```ts
workflow("deploy").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
  s.exec("git rev-parse HEAD", { capture: "sha" })
   .exec("echo deploying commit {{sha}}"),
)
```
