---
"@drej/agent": patch
---

Fix the Pi bridge silently dropping a rejected `/prompt` call. When Pi rejects a prompt outright (e.g. no API key configured for the provider), its ack isn't tracked the way `/bash` results are, so the bridge previously just discarded it — the client's SSE stream would sit open indefinitely (kept alive by the heartbeat) instead of ever completing. The bridge now forwards the rejection as an error and ends the stream immediately.
