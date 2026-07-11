---
"@drej/agent": patch
---

Fix the Pi bridge's `/prompt` and `/bash` SSE responses dying on OpenSandbox's generic port-proxy: that endpoint proxies through an httpx client with no configured read timeout (defaults to 5s), so any gap that long between bytes written — model thinking time, a slow tool call — got the proxy's connection killed, surfacing as a 500 or a silently-truncated stream. A periodic `: ping` SSE comment now keeps that idle timer from firing during long-running prompts and bash calls.
