# snapshot-replay

Demonstrates drej's snapshot and replay feature: run a workflow once to install dependencies and capture a snapshot, then replay from that snapshot — skipping the install — to run updated code against the same environment.

## Run

```bash
bun install
bun start
```

## What it does

**Initial run**
1. Creates a Python 3.11 sandbox
2. Installs `requests` via pip
3. Captures a snapshot after the install step
4. Runs a script against httpbin

**Replay**
1. Boots a new sandbox from the snapshot (pip install already done)
2. Runs an updated script that fetches a different endpoint
