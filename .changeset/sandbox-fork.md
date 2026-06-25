---
"drej": minor
---

Add `sb.fork(tag?)`: snapshot a live sandbox and return a new independent `Sandbox` from that state without closing the original. The forked sandbox gets its own ledger session and concurrency slot. The fork checkpoint is visible in `sb.listCheckpoints()` and usable with `client.resume()`.
