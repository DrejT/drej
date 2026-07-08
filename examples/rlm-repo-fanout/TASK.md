# Task: backfill missing example READMEs

The repo is cloned at ./repo (drej, a sandbox execution substrate). Every
folder under ./repo/examples/ should have a README.md describing, in one
short paragraph, what capability that example demonstrates (base it on the
index.ts file in that folder).

Some folders are missing one. Find out which ones, decide how to split the
work among spawned child agents (you have the drejx CLI and a spawn budget
of 1 -- run "drejx spawn --help" if unsure of exact syntax), and have each
child write the missing README.md for ONE example inside its own copy of
the repo (children start from your exact checked-out commit, so their
edits apply to the same tree).

Each child should:

- Write repo/examples/<name>/README.md (a short paragraph, no more).
- Run "cd repo && git diff" and report the full diff as its final answer.
- NOT commit or push anything.

When all children report back, combine their diffs and report the combined
patch set as your OWN final answer, in a fenced code block. Do not apply,
commit, or push anything yourself either -- this task is about producing a
reviewable patch set, not merging it.
