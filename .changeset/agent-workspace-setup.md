---
"@drej/agent": minor
---

Add `setup` steps to `AgentSpec`: declarative bash commands that run after Pi CLI install and are baked into the snapshot. Any change to the steps automatically invalidates the snapshot cache.
