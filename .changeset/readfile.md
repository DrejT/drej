---
"drej": minor
"@drejt/core": minor
---

Add `s.readFile(path, { as })` step to read sandbox files into workflow state

File contents are stored under the given key and immediately available for
interpolation in subsequent steps via `{{key}}`, or accessible on the final
workflow state after the run. Supports `utf8` (default) and `base64` encoding.

```ts
workflow("build").sandbox({ image: { uri: "node:20-slim" } }, (s) =>
  s.exec("node -e \"process.version\" > /tmp/version.txt")
   .readFile("/tmp/version.txt", { as: "version" })
   .exec("echo Node version: {{version}}"),
)
```
