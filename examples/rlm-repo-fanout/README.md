# rlm-repo-fanout

The showcase example for `plans/drejx-rlm-substrate.md`: a master agent clones
a repo, decides how to split a task across it, and spawns child agents — via
`drejx spawn`, built on the new `Agent.spawn()` — that each work on one slice
starting from the _exact same checked-out commit_ as the master, not a fresh
clone. This is the "shared live state" fan-out shape (pattern b in the plan),
the one that needed new plumbing beyond what `drejx run` already gave for
free.

See `RUBRIC.md` for the full gate-by-gate evidence packet against the
[RLM rubric](https://github.com/rawwerks/recursive-coding-agents/blob/main/rlm-rubric/rlm-rubric.md).

## Setup

```bash
bunx drejx init   # starts OpenSandbox in Docker (one-time setup)
```

Needs `NVIDIA_API_KEY` in the repo root `.env` (Pi's model provider for both
the master and its children — NVIDIA NIM's free-tier `openai/gpt-oss-20b`
model, chosen both to avoid competing with Gemini's separate free-tier quota
and, after benchmarking several NVIDIA NIM models, for being the fastest and
most reliable at tool calling — see `RUBRIC.md`'s "Why this model" section).

If your OpenSandbox server isn't reachable from inside containers at
`172.17.0.1:8080` (the default Docker bridge gateway), override it:

```bash
export MASTER_AGENT_OPENSANDBOX_DOMAIN=<your-routable-host:port>
```

See `examples/pi-agent/test-spawn-child.ts` for the two things that have to
be true for a container to reach the server at all.

## Run

```bash
bun examples/rlm-repo-fanout/index.ts
```

## What it does

1. Loads the master agent (`agents/master.json`) — its setup steps clone this
   repo, install the `drejx` CLI, write `drej.config.json` so `drejx` can
   reach the OpenSandbox server from inside the container, add a worker spec,
   and write `TASK.md` (the actual goal — see below).
2. Sends the master one short prompt: "read TASK.md and do it." The goal
   itself lives in a file, not in the prompt string (G2 — externalized
   context, not pasted into the root context).
3. The master is expected to inspect the repo, decide how many children to
   spawn and how to split the work (G6 — left to the model, not scripted),
   then loop `drejx spawn rlm-fanout-master ./agents/worker.json --prompt
"<slice>" --json` once per slice (G5 — code inside the sandbox calling
   sub-agents over constructed slices, not the master verbally asking a tool).
   Each spawned child starts from the master's exact live filesystem —
   same commit, same working tree.
4. Each child writes its one file, runs `git diff`, and reports the diff as
   its own final answer (G7 — the artifact stays as a file; only the diff
   text, not full repo contents, comes back to the master).
5. The master combines the diffs it collected and reports the patch set as
   its own final answer. It does not apply, commit, or push anything —
   neither does any child.
6. The script then independently verifies the run — not just believes the
   model's summary. See `RUBRIC.md` for exactly what's checked and why.

## The task

`TASK.md` (baked into the master's sandbox by a setup step — see the file in
this directory for the exact text): find every `examples/*` folder in the
cloned repo missing a `README.md`, and have spawned children write the
missing ones, each describing what that example demonstrates based on its
`index.ts`.

This isn't the point of the exercise — it's a task that's cheap, safe (never
touches this actual repository, only sandboxed clones), and naturally
decomposes into an unpredictable number of independent slices, which is
exactly what's needed to observe G6 honestly.

## Cleanup

The script closes the master and every child sandbox it finds in a `finally`
block, whether the run passed or failed.

## Known limitation

On some OpenSandbox setups, `master.prompt(...)` can fail with a `500` from
the server's own proxy — an OpenSandbox-side issue unrelated to `Agent.spawn()`
itself, isolated and documented in `RUBRIC.md`'s "Known limitation" section.
`Agent.spawn()`'s own mechanism (fork, env-leak fix, depth injection) is
independently verified live in `plans/drejx-rlm-substrate.md`'s test notes
via `.bash()`, which doesn't hit this proxy issue.
