---
"drej": minor
"@drej/core": minor
"@drej/opensandbox": minor
---

Add `sb.exec(cmd, { interactive: true })` for live, bidirectional PTY sessions — human-in-the-loop CLI access inside a sandbox. Returns an `InteractiveExecHandle` with `write()`, `resize()`, `signal()`, `close()`, and `attach()` in addition to the usual `stdout()`/`pipe()`/`result()`/`await` surface.

Every `write()` is logged to the ledger alongside output, so a session still open at the last checkpoint is reconstructed on resume by replaying its recorded stdin for real against the freshly restored filesystem (OpenSandbox snapshots are rootfs-only — the original process is gone after resume, so this is the only way to re-derive shell state like exported vars or `cd`s).

`@drej/opensandbox` gains a `PtyClient` wrapping execd's `/pty` REST + WebSocket protocol.
