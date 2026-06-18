---
"drej": minor
---

Add `write_file` workflow step type and always base64-encode `exec_command` strings.

- `write_file` step writes text or binary content to a path inside the sandbox; accepts `encoding: "utf8"` (default) or `"base64"` for binary files
- `exec_command` now unconditionally base64-encodes the command string before sending to the container, eliminating all quoting and special-character edge cases
