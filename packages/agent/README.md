# @drej/agent

Run [Pi](https://pi.ai) coding agents inside isolated [drej](https://drej.dev) sandbox containers. Pi can read and write files, run shell commands, and execute scripts — streamed back through a simple TypeScript API.

```bash
bun add @drej/agent
```

**[Full documentation →](https://docs.drej.dev/docs/agent)**

---

## Quickstart

Create an agent spec (`agents/my-agent.json`):

```json
{
  "$schema": "https://registry.drej.dev/schema/agent-item.json",
  "name": "my-agent",
  "cli": "pi",
  "model": "gemini-flash-latest",
  "packages": ["python3"],
  "env": { "GEMINI_API_KEY": "${GEMINI_API_KEY}" },
  "resources": { "cpu": "1000m", "memory": "2Gi" }
}
```

```ts
import { Agent } from "@drej/agent";

const agent = await Agent.load("./agents/my-agent.json");
try {
  for await (const chunk of agent.prompt("Write and run a Python hello world script.")) {
    process.stdout.write(chunk);
  }
} finally {
  await agent.close();
}
```

---

## API

### `Agent.load(specPath)`

Loads an agent spec, spins up an OpenSandbox container, installs the Pi CLI, and returns a ready `Agent` instance.

### `agent.prompt(message)`

Sends a message to the agent and returns a `PromptStream` — an `AsyncIterable<string>` of response chunks.

```ts
for await (const chunk of agent.prompt("Refactor this file to use async/await")) {
  process.stdout.write(chunk);
}
```

### `agent.steer(message)`

Inject a mid-stream instruction while the agent is responding.

### `agent.sandbox`

Direct access to the underlying `Sandbox` — read files, run commands, or inspect state independently of Pi.

```ts
const output = await agent.sandbox.readFile("/workspace/result.txt");
```

### `agent.setEnv(vars)`

Set environment variables in the sandbox at runtime.

### `agent.newSession()`

Start a fresh conversation session without restarting the container.

### `agent.abort()`

Interrupt the current in-progress prompt.

### `agent.close()`

Shuts down the sandbox. Always call in a `finally` block.

---

## License

Apache 2.0
