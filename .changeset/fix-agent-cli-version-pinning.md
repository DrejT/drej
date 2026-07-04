---
"@drej/agent": patch
"docs": patch
---

`AgentSpec.cliVersion` now actually pins the installed Pi CLI version. Previously it was only used as a setup-hash cache-key input — `install()` always ran `npm install -g @earendil-works/pi-coding-agent` with no version qualifier, so setting `cliVersion` had no effect on which version got installed. `install()` now runs `npm install -g @earendil-works/pi-coding-agent@<cliVersion>` when `cliVersion` is set (accepts an exact version, a semver range, or a dist-tag like `"latest"`), and falls back to the bare package name when omitted.
