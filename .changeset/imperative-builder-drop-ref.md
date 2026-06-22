---
"drej": minor
---

Replace `ref()` / `as:` with imperative builder that returns typed refs inline.

Output-producing methods (`readFile`, `searchFiles`, `listDirectory`, `getFileInfo`, `exec` with `capture: true`) now return a `Ref<T>` directly — no pre-declaration or `as:` option needed. Use the returned variable in template literals to interpolate values in later steps.

```ts
// before
const files = ref<string[]>("files");
s.searchFiles("*.ts", { as: files, dir: "/src" })
 .exec(`echo ${files}`)

// after
const files = s.searchFiles("*.ts", { dir: "/src" });
s.exec(`echo ${files}`);
```

Breaking changes:
- `ref()`, `Ref`, `refKey`, `refStr` removed from public API
- `as:` option removed from all output methods
- `exec` capture changes from `{ capture: "name" }` to `{ capture: true }` (returns `Ref<string>`)
- Callback signatures for `sandbox`, `retry`, `when`, `parallel`, `forEach` change return type from `SandboxStepBuilder` to `void`
