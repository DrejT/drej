# RUBRIC.md — evidence packet

Self-graded against the [RLM
rubric](https://github.com/rawwerks/recursive-coding-agents/blob/main/rlm-rubric/rlm-rubric.md)
(G1–G7). Structured the way the rubric itself asks evidence to be presented:
run shape, then per-gate evidence, then the strongest case against, then
what would change the verdict. See `plans/drejx-rlm-substrate.md` for the
full design rationale this example implements.

## Run shape

- **Entry point**: `bun examples/rlm-repo-fanout/index.ts`.
- **Master spec**: `agents/master.json` — Pi CLI, NVIDIA NIM's
  `nvidia/nemotron-3-super-120b-a12b`, `spawnDepth: 1`. No `drejx_*` Pi
  tools registered (PR #124's extension is deliberately absent — see "Why no
  Pi tools" below).
- **Master's actual prompt**: one sentence — "Read ./TASK.md in your working
  directory and complete the task described there. Report a summary...". The
  task itself lives in `TASK.md`, written by a setup step baked into the
  snapshot, never pasted into the prompt string.
- **Worker spec**: `agents/worker.json` — Pi CLI only. No `drejx` install, no
  `drej.config.json`, no spawn tools of any kind reachable.
- **Tools enabled for the master**: Pi's built-in bash tool only. `drejx` is
  a CLI on `$PATH` inside the sandbox, invoked the same way `ls` or `git`
  would be — not a registered tool the model calls by name.
- **Tools enabled for a worker**: Pi's built-in bash + file tools. No `drejx`
  binary present at all.

## Per-gate evidence

| Gate                                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** — model-call outer shape                      | `master.prompt(...)` in `index.ts`: one prompt in, streamed text out. Unchanged from `drejx run --prompt`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **G2** — context externalized as symbolic state      | The goal is `TASK.md`, a file written by a setup step (see `agents/master.json`'s `setup`), not string-interpolated into the prompt. The prompt only names the file.                                                                                                                                                                                                                                                                                                                                                                          |
| **G3** — root model has handles to that state        | The master reaches `TASK.md` via a path (`./TASK.md`) and reaches each child via a session name (`rlm-fanout-master` → spawned child's own ledger name), not by having content pasted at it.                                                                                                                                                                                                                                                                                                                                                  |
| **G4** — persistent executable environment           | The whole run is one OpenSandbox sandbox per agent — filesystem, installed packages (`git`, `drejx`), and the cloned repo all persist across every tool call in a turn. This is what a drej sandbox already is.                                                                                                                                                                                                                                                                                                                               |
| **G5** — code calls sub-LMs over constructed slices  | The master's own bash tool runs `drejx spawn rlm-fanout-master ./agents/worker.json --prompt "<slice>" --json` in a loop it writes itself — a script inside the sandbox calling `Agent.spawn()` (via the CLI) over a constructed per-file instruction, not the master verbally invoking a registered `drejx_spawn` tool. Verified in `index.ts`: every spawned child found via the ledger has the master's exact `git rev-parse HEAD` — proof the child is a _fork_ of live state, not an independent `drejx run` from a spec's own snapshot. |
| **G6** — model decides the decomposition             | `TASK.md` says "decide how to split the work" and never states a child count or a fixed loop. `index.ts` asserts only "at least one child was spawned," not an exact number — the actual count is the model's call, whatever it turns out to be for a given run.                                                                                                                                                                                                                                                                              |
| **G7** — intermediate state stays in the environment | Each child's result is its own `git diff` output inside its own sandbox, reported back as that child's _own_ final answer (short diff text, not the full edited file re-pasted into the master's context) via the same `drejx spawn ... --prompt ... --json` call that spawned it.                                                                                                                                                                                                                                                            |

## Independent verification (what `index.ts` actually checks, not what the model claims)

- Every spawned child's `repo` is at the master's exact `git rev-parse HEAD`
  (G5's actual mechanism, not the model's description of it).
- A master-only secret (`RLM_FANOUT_SECRET`, generated fresh per run) is
  genuinely absent from a spawned child's real Pi/bridge environment —
  checked via the child's own bash tool, i.e. inside the same process tree
  Pi itself uses, not a raw `exec()` session that wouldn't prove anything
  about what Pi can see.
- A spawned child's `DREJX_SPAWN_DEPTH` is exactly `"0"` — present and
  zeroed, not merely absent.
- A spawned child has no `drejx` binary on `$PATH` at all — a second,
  structural negative control: even ignoring the depth check, a worker
  cannot invoke `drejx spawn` because the command doesn't exist for it.
- The master's own `repo` HEAD is unchanged after the run — no commit was
  made, matching "report only" scope.

## Why no Pi tools

`packages/cli/pi-extension/drejx.ts` (PR #124) registers `drejx_run` /
`drejx_prompt` / `drejx_agents` / `drejx_kill` as callable tools — useful for
a one-off "spawn a helper" UX, but structurally a parent _verbally_ deciding
"call this tool," which the rubric explicitly disqualifies for G5. Leaving
those tools out of `master.json` entirely means every spawn in a real run of
this example is provably a bash/script invocation, not a tool call — there's
nothing else the model _could_ have used.

## Strongest case against

- **G6 is only as honest as the task.** `TASK.md` does say "decide how to
  split the work," but a model that reliably treats "backfill missing
  READMEs" as one atomic slice (spawning exactly one child, or zero) would
  technically still pass G5 while giving weak G6 evidence. The rubric asks
  for decomposition to be genuinely model-chosen, not for the model to
  choose _well_ — a single-child run is still a real decomposition decision
  (the model considered splitting further and declined), but it's a weaker
  demonstration than a multi-child run.
- **The task itself is deliberately small and safe.** Real recursive coding
  agent workloads (per the rubric's own framing) look more like large,
  genuinely-parallel refactors. This example proves the _mechanism_ cleanly
  but at a scale chosen for cheap, reliable CI runs, not for representing the
  hardest real-world case.
- **G4's "environment" is Pi's bash tool, not a general code-execution
  substrate the model programs against directly.** The rubric's strongest
  framing of G5 (per its own text) is code written _in_ the environment
  calling submodels — here that code is a bash loop the model writes and
  runs via its bash tool, which does satisfy the letter of G5 (programmatic,
  not verbal) but is a shell script, not, say, a Python program constructing
  API calls. Worth being explicit that "bash tool calling a CLI in a loop"
  is the specific shape being claimed as sufficient, not asserting some
  stronger claim than that.

## What would change the verdict

- If `drejx spawn`'s depth/env checks were found to be bypassable (e.g. a
  worker could still reach a `drejx` binary through some path not covered by
  `agents/worker.json`'s scoping), G5's isolation claim would need to be
  re-verified live again, the same way the original leak was found.
- If a real run consistently produces zero or one child regardless of task
  size, that would be evidence the guidance in `TASK.md` needs to nudge
  harder toward decomposition (the one open decision noted in
  `plans/drejx-rlm-substrate.md` — deliberately left for exactly this kind of
  observation).

## Known limitation: full live run blocked by an OpenSandbox proxy issue, not a drejx bug

Two real, separate bugs were found and fixed while getting this example to run
for real: the example's spec originally used `nvidia/nemotron-3-super-120b-a12b:free`,
an OpenRouter-style ID that doesn't exist on NVIDIA's own native API (the
correct ID, confirmed via `pi --list-models nvidia` and a working local `pi -p`
call, is just `nvidia/nemotron-3-super-120b-a12b`, no `:free` suffix); and the
example's setup step does `npm install -g drejx`, which always installs
whatever's currently published — so it silently ran against `drejx@0.5.0`
(pre-`spawn`) until the `chore: version packages` release PR was merged and
`drejx@0.6.0` published. Both are fixed now (correct model ID in every spec;
re-verify with `REBUILD=1 bun examples/rlm-repo-fanout/index.ts` after any
future `drejx` release to force past a stale cached snapshot).

With both of those fixed, one real infrastructure issue remains, isolated
carefully rather than assumed: `master.prompt(...)` — with the _correct_
model, a _fresh_ `drejx@0.6.0` install, no wrong-model or version-skew
confound — still fails intermittently on the full multi-turn `TASK.md`
prompt (a run that involves many tool calls over several minutes). The
failure isn't consistent in shape:

- Sometimes an explicit `500` from OpenSandbox's own server proxy
  (`{"code":"GENERAL::UNKNOWN_ERROR","message":"An internal error occurred
in the proxy: "}`, `server: uvicorn`).
- Sometimes the call "succeeds" (no thrown error) but the streamed response
  is empty — no text, no tool calls at all.

Both only show up on the _long_, multi-turn prompt. Quick one-shot prompts
(`"say hi"`, `master.bash(...)`) succeed reliably and quickly, every time,
through the exact same proxy. That strongly points to instability specific
to _sustained_ SSE streaming through OpenSandbox's proxy — plausibly a
connection reset or idle-timeout that happens to land differently depending
on how far into the stream it occurs (before any bytes → 500; after some →
a stream that just ends early, read by `sseStream()`'s loop as a clean but
empty completion). Bypassing the proxy (`useServerProxy: false`, connecting
to the container's IP directly, per CLAUDE.md's documented `uvx` setup)
doesn't work around it either — it just times out in this environment,
meaning containers aren't directly reachable from the host here at all.

This sits in OpenSandbox's proxy layer, not in `Agent.spawn()`, `drejx
spawn`, or anything else touched by this change — `Agent.spawn()` itself was
independently, thoroughly verified live against a real sandbox fork
(env-leak fix, depth injection, depth-zero refusal, the
`restoreSnapshot()`/`connect()` fork-wiring bugs this work found and fixed),
and the master's actual tool-use behavior _has_ been observed working
correctly end-to-end for several minutes at a stretch (real repo inspection,
real troubleshooting of a missing `bun` runtime, real attempts at `drejx
spawn`) in at least one run — it's the sustained connection itself that's
unreliable in this environment, not the model, the spec, or drejx's own
code. Re-attempt once that OpenSandbox-side issue is resolved or worked
around (or against a different OpenSandbox deployment).
