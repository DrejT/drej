# control-flow

Demonstrates all of drej's built-in control-flow primitives in a single workflow.

## Run

```bash
bun install
bun start
```

## What it shows

| Primitive | Description |
|-----------|-------------|
| `retry`   | Retries a flaky command up to 5 times with exponential backoff |
| `when`    | Branches conditionally on workflow state |
| `forEach` | Iterates over a list with a loop variable |
| `parallel`| Runs two branches concurrently inside the same sandbox |
