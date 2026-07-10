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
  `nvidia/nemotron-3-super-120b-a12b` (chosen after benchmarking several
  NVIDIA NIM models for speed/reliability/tenacity — see "Why this model"
  below), `spawnDepth: 1`. No `drejx_*` Pi tools registered (PR #124's
  extension is deliberately absent — see "Why no Pi tools" below).
- **Master's actual prompt**: one sentence — "Read ./TASK.md in your working
  directory and complete the task described there. Report a summary...". The
  task itself lives in `TASK.md`, written by a setup step baked into the
  snapshot, never pasted into the prompt string.
- **Worker spec**: `agents/worker.json` — Pi CLI only, `nvidia/nemotron-3-nano-30b-a3b`
  (faster than the master's model — a worker's task is a single bounded edit,
  not multi-step decomposition, so speed matters more than tenacity here). No
  `drejx` install, no `drej.config.json`, no spawn tools of any kind reachable.
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

## Why this model

Benchmarked several NVIDIA NIM models locally first (`pi -p --provider
nvidia --model <id> ...`, outside any sandbox — a plain text prompt and a
single bash-tool-calling prompt, timed):

| Model                               | Text        | Tool call                                  | Verdict                                                  |
| ----------------------------------- | ----------- | ------------------------------------------ | -------------------------------------------------------- |
| `openai/gpt-oss-20b`                | 3.5s        | 2.5s (2.1–2.3s over 3 repeats)             | Fastest single-call — but see below                      |
| `nvidia/nemotron-3-nano-30b-a3b`    | 8.3s        | 3.6s                                       | Good, clean tool calls                                   |
| `meta/llama-3.1-8b-instruct`        | 2.8s        | 6.9s                                       | Good                                                     |
| `nvidia/nvidia-nemotron-nano-9b-v2` | 4.5s        | 11.7s                                      | OK, slower tool calls                                    |
| `nvidia/nemotron-3-super-120b-a12b` | 5.7s        | 8.6s                                       | Slower per call, but see below — **used for the master** |
| `qwen/qwen3.5-122b-a10b`            | 1.9s        | **error** — "Unexpected end of JSON input" | Broken tool calling through NVIDIA's endpoint — avoid    |
| `meta/llama-3.3-70b-instruct`       | **timeout** | **timeout**                                | Unreliable — avoid                                       |

That single-call benchmark turned out to be an incomplete signal for what
this example actually needs — a model that stays on-task across a _long_,
multi-tool-call session (find missing files, decide a split, spawn children,
collect results), not just answer one prompt quickly. Two things only showed
up in real sandboxed multi-turn runs:

- **`openai/gpt-oss-20b` leaks its own "harmony" chat-template channel
  tokens into tool names** (`bash<|channel|>commentary`, `bashcommentary`)
  on roughly half its tool calls when served through NVIDIA — every one of
  those calls fails before the tool even runs, since the mangled name
  doesn't match anything registered. Fastest per-call, but unusable for a
  sustained session. Likely a template mismatch specific to NVIDIA serving
  an OpenAI-family model, not something wrong with gpt-oss itself.
- **`nvidia/nemotron-3-nano-30b-a3b`** (a native NVIDIA model, so no
  cross-vendor template mismatch) had completely clean tool calls, but
  showed real run-to-run variance in _tenacity_ — some runs explored the
  repo thoroughly and attempted a real `drejx spawn` call, others gave up
  after two tool calls without trying. Good for the worker's single bounded
  edit; not reliable enough for the master's longer decomposition work.
- **`nvidia/nemotron-3-super-120b-a12b`**, tried again after fixing two
  unrelated bugs that had been muddying every earlier read on this model
  (see "Known limitation" below), showed the most persistent, thorough
  multi-turn behavior of anything tested — including self-recovering from a
  missing `bun` runtime by installing it unprompted. Slower per call, but
  actually finishes the reasoning chain. Used for the master; the worker
  keeps the faster `nemotron-3-nano-30b-a3b` since its job is one bounded
  edit, not open-ended decomposition.

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

## Debugging history: every real bug found getting this to run live

Getting a live run of this example working surfaced a chain of real, distinct
bugs — worth recording in full since several looked like something else
entirely until isolated:

1. **Wrong model ID.** The spec originally used
   `nvidia/nemotron-3-super-120b-a12b:free` — an OpenRouter-style suffix that
   doesn't exist on NVIDIA's own native API. Found via `pi --list-models
nvidia` and a working local `pi -p` call with the correct ID (no `:free`).
2. **Stale published `drejx`.** The setup step's `npm install -g drejx`
   always installs whatever's currently on npm — it silently ran against
   `drejx@0.5.0` (pre-`spawn`) until the `chore: version packages` PR merged
   and `0.6.0` published. (`examples/rlm-repo-fanout/index.ts` has a
   `REBUILD=1` escape hatch to force past a stale cached snapshot after any
   future `drejx` release.)
3. **A genuine OpenSandbox proxy bug.** Confirmed via DeepWiki against
   `opensandbox-group/OpenSandbox`: the generic `/sandboxes/{id}/proxy/{port}`
   endpoint (what `sb.proxy()` routes through) proxies via an `httpx` client
   with no configured read timeout, which falls back to httpx's 5s default.
   Any gap that long between bytes written to the bridge's SSE response
   (model thinking time, a slow tool call) got the proxy's connection to the
   bridge killed — a `500`, or a stream that silently ended early. Fixed in
   `packages/agent/src/adapters/pi.ts`: the bridge now writes a `: ping` SSE
   comment (spec-legal, ignored by clients) every 3s while a `/prompt` or
   `/bash` call is in flight, keeping that idle timer from ever firing.
4. **The bridge silently dropped a failed prompt.** Even with the heartbeat
   fix, a run could still hang forever: if Pi rejected a prompt outright
   (`{"success":false,"error":"..."}`), that ack isn't tracked the way
   `/bash` results are, so the bridge just... didn't forward it. The client
   sat behind the heartbeat indefinitely instead of seeing a clean error.
   Fixed in the same file: a rejected prompt now ends the SSE stream with the
   real error immediately.
5. **What #4 was actually masking.** Once errors surfaced instead of hanging,
   Pi reported `"No API key found for nvidia"` — even though the key was
   right there in `.env`. Root cause: Bun only loads `.env` from the shell's
   CWD at invocation, it does not walk up to the repo root — running this
   example from inside `examples/rlm-repo-fanout` (which has no `.env` of
   its own) silently resolved `NVIDIA_API_KEY` to an empty string. The
   example builds a sandbox fine either way; only the _live model call_
   fails. `index.ts` now checks `NVIDIA_API_KEY` up front and refuses with a
   clear message instead of building a doomed sandbox.
6. **Missing `bun` runtime.** `drejx`'s own npm package ships with a
   `#!/usr/bin/env bun` shebang — the `node:22` base image has no `bun` at
   all, so `drejx` couldn't run regardless of everything else being correct.
   `master.json`'s setup now installs bun and symlinks it onto `/usr/local/bin`
   (already on `$PATH` by default), rather than relying on a per-exec-session
   `PATH` export that wouldn't persist anyway.
7. **`openai/gpt-oss-20b` mangles tool names via NVIDIA.** Fastest in
   single-call benchmarks, but leaks its own "harmony" chat-template channel
   tokens into tool names (`bash<|channel|>commentary`) on roughly half its
   calls when served through NVIDIA — every one of those fails before the
   tool even runs.
8. **A structural Pi+NVIDIA tool-calling issue, found across three separate
   models, not fixed.** After #1–7, `index.ts` was updated to log a failed
   tool call's actual result content (not just `isError`), which is what
   surfaced this clearly instead of leaving it as an unexplained hang. Three
   different models, driven the same way through Pi's `openai-completions`
   API path against NVIDIA, each corrupted tool calls in a _different_
   shape:
   - `openai/gpt-oss-20b` — its harmony-format channel tokens leak into the
     tool _name_ (item 7, above).
   - `nvidia/nemotron-3-nano-30b-a3b` — occasionally emits a raw
     `<function=bash><parameter=command>...` XML-ish string as plain text
     instead of a real tool call.
   - `nvidia/nemotron-3-super-120b-a12b` — its own reasoning text and a
     _second_, nested tool-call attempt bled into the _first_ call's command
     argument (`"ls.\n\nWe need to use drejx spawn command...<tool_call>\n
<function=bash>\n<parameter=command>\nls -la"`), producing an
     unparseable shell string and a `127` exit — the master's turn ended
     right after, without retrying.

   Three models, three different corruption shapes, through one integration
   path — that's a pattern pointing at Pi's streaming tool-call parser for
   NVIDIA's API specifically, not any one model's competence. Not something
   fixable by trying yet another NVIDIA model. The two real next steps are:
   report this upstream to Pi as a parsing bug against NVIDIA's
   `openai-completions` implementation, or switch this example to a provider
   Pi's tool-call parser is presumably better exercised against (Anthropic's
   or OpenAI's own APIs — which reintroduces the cost/quota question this
   whole NVIDIA detour was meant to avoid, just for a different, more
   fundamental reason this time: correctness, not price).

With #1–7 fixed, live runs do show the master doing genuine, sustained,
multi-minute tool use when a corrupted call doesn't derail it early — real
repo inspection, a precomputed `MISSING_READMES.txt` (cuts exploratory tool
calls, see "Why this model"), and in one run the exact correct `drejx spawn`
syntax. #8 is the reason no run has yet completed a full spawn-and-collect
cycle end to end. `Agent.spawn()` itself remains independently, thoroughly
verified via `.bash()` and direct SDK calls (env-leak fix, depth injection,
depth-zero refusal, the `restoreSnapshot()`/`connect()` fork-wiring bugs
found along the way) — the mechanism this example exists to showcase is
correct; #8 is a provider-integration issue sitting one layer up, in how the
model's own tool calls get generated and parsed, not in anything `drejx`
does with them once they arrive clean.
