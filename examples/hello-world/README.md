# hello-world

The simplest drej workflow: spin up an Ubuntu sandbox, run `echo "hello world"`, and stream the output.

## Run

```bash
bun install
bun start
```

## What it does

1. Creates an Ubuntu 22.04 sandbox
2. Executes `echo "hello world"` inside it
3. Streams every workflow event to stdout, printing exec output as it arrives
4. Deletes the sandbox on completion
