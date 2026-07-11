---
"drejx": patch
---

`drejx prompt` and `drejx kill` now take a sandbox ID instead of a session name. Session names aren't unique — running `drejx run` twice on the same spec produces two sandboxes with the same name — and a name-based lookup could hand back a sandbox that already died ungracefully (crashed before its `close()` ran, expired via OpenSandbox's own TTL), since nothing tells the ledger it stopped. Addressing by sandbox ID removes the ledger detour entirely; the live control-plane check inside `connect()`/`resume()` is the only check, not a second opinion after an already-stale one.

`drejx prompt` also gains `--spec <path>` to skip its own ledger lookup for the spec file, needed when prompting a sandbox whose `sandbox_created` event lives in a different ledger than the CLI's own (e.g. a child spawned via `drejx spawn` from inside another sandbox).

The Pi extension (`pi-extension/drejx.ts`)'s `drejx_prompt`/`drejx_kill` tools are updated to match.
