---
"drejx": patch
---

Internal restructure: replace the hand-maintained `switch` + separately
hand-written help-text string in `packages/cli/src/index.ts` with a command
registry (`packages/cli/src/commands/{types,args,registry}.ts`). Each
command file now exports its own `xCommand: CliCommand` (argv parsing,
usage, and summary colocated with its logic), and `index.ts` dispatches and
generates help text from a single `commands` list — a rename or flag change
can no longer leave the help text saying something different from what the
command actually does, which happened at least once this session.

`registry.ts` keeps command metadata (name/group/usage/summary) as plain
data with a `run` that dynamically imports each command's implementation
only when invoked, preserving the original per-command lazy-loaded chunks —
an earlier version of this change statically imported every command
up front, which measured ~3x slower for something as trivial as
`drejx --version` (every command's own dependencies, e.g. `@drej/agent`,
loading eagerly on every invocation). Verified no regression after the fix.

No behavior change to any command's flags, argument order, or output.
Generated help text matches the old hand-written version's content (column
widths are now computed per-section instead of hand-tuned).

Part of the codebase restructure plan (plans/codebase-restructure.md,
Phase 5).
