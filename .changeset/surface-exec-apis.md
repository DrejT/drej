---
"drej": minor
---

Surface OpenSandbox exec and file-system capabilities on the public `Sandbox` API:

- `sb.exec(cmd, { timeoutMs })` — abort commands after N milliseconds
- `sb.proxy(port)` — get a proxied URL and auth headers for an in-sandbox port
- `sb.metrics()` — return current CPU and memory usage
- `sb.createDirectory(path)` / `sb.deleteDirectory(path)` — direct directory operations
- `sb.getFileInfo(path)` — file metadata (size, type, mode, timestamps)
- `sb.replaceInFiles(replacements)` — targeted in-place multi-file string replacement
- `sb.transfer(path, target)` — copy a file between two `Sandbox` instances
- `client.sandbox({ metadata })` — attach arbitrary key-value labels at sandbox creation
- `FileInfo` is now exported from `drej`
