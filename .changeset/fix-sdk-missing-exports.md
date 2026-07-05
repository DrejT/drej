---
"drej": patch
---

Fix `drej`'s public entry point (`src/index.ts`) silently omitting several types that were already re-exported from `client.ts` — `BashSession`, `InteractiveExecHandle`, `PendingInteractiveExec`, `CheckpointInfo`, `EnvironmentRecord`, `FileInfo`, `DiagnosticLog`, `DiagnosticEvent`, `Metrics`, `ResumeOptions`, `Environment`, `EnvironmentOptions`, and `EnvironmentSandboxOptions` never reached the built package because `index.ts` re-declared `client.ts`'s exports one by one instead of forwarding them, and had drifted out of sync across several past features (most recently the `interactive: true` PTY exec support). `index.ts` now does `export * from "./client"`, so this class of drift can't recur.
