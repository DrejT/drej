---
"drej": minor
---

Make `resources` required in `SandboxOptions` (`cpu` and `memory` are now required fields). The OpenSandbox server rejects requests without resource limits — this makes the constraint explicit at the type level.
