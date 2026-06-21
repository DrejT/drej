---
"drej": minor
"@drej/core": minor
---

Add file ops steps and `ref()` builder API

New step types: `deleteFile`, `moveFile`, `listDirectory`, `searchFiles`.

`listDirectory` stores `DirectoryEntry[]` in state under the given key; `searchFiles` stores `string[]` which can be passed directly to `forEach`.

New `ref<T>(name)` function creates a typed state reference. Use it instead of raw `"{{name}}"` strings anywhere the builder accepts a captured value:

```ts
const sha = ref<string>("sha")
const tsFiles = ref<string[]>("tsFiles")

workflow("build").sandbox({ image: { uri: "node:20" } }, (s) =>
  s.exec("git rev-parse HEAD", { capture: sha })
   .searchFiles("**/*.ts", { as: tsFiles })
   .forEach(tsFiles, (s, file) => s.exec(`tsc ${file}`))
   .exec("deploy.sh", { envs: { GIT_SHA: sha } })
)
```

`Ref<T>` objects also work naturally in template literals: `` `echo ${sha}` `` expands to `"echo {{sha}}"` at build time.

Also fixes: `cwd` and `envs` values in `exec()` are now interpolated against workflow state at runtime (previously passed verbatim).
