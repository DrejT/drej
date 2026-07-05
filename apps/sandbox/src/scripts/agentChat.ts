import { wsUrl } from "./api";

type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "bridge_error"; message: string }
  | { type: string; [key: string]: unknown };

export function mountAgentChat(agentId: string): { dispose(): void } {
  const messages = document.getElementById("chat-messages") as HTMLDivElement;
  const form = document.getElementById("chat-form") as HTMLFormElement;
  const input = document.getElementById("chat-input") as HTMLInputElement;
  const steerBtn = document.getElementById("chat-steer-btn") as HTMLButtonElement;
  const abortBtn = document.getElementById("chat-abort-btn") as HTMLButtonElement;

  let streaming = false;
  let assistantBubble: HTMLDivElement | null = null;

  function setStreaming(value: boolean) {
    streaming = value;
    steerBtn.disabled = !streaming;
    abortBtn.disabled = !streaming;
    assistantBubble = null;
  }

  function addBubble(role: "you" | "agent" | "tool" | "error", text: string): HTMLDivElement {
    const bubble = document.createElement("div");
    bubble.className =
      role === "you"
        ? "self-end rounded-lg bg-[var(--color-accent)] px-3 py-2 text-white"
        : role === "error"
          ? "rounded-lg border border-[var(--color-danger)] px-3 py-2 text-[var(--color-danger)]"
          : role === "tool"
            ? "mono rounded-lg bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-muted)]"
            : "rounded-lg border border-[var(--color-border)] px-3 py-2";
    bubble.textContent = text;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  const ws = new WebSocket(wsUrl(`/ws/agents/${agentId}/chat`));

  ws.addEventListener("message", (ev) => {
    if (typeof ev.data !== "string") return;
    const event = JSON.parse(ev.data) as AgentEvent;
    if (event.type === "agent_start") {
      setStreaming(true);
    } else if (event.type === "agent_end") {
      setStreaming(false);
    } else if (event.type === "text") {
      if (!assistantBubble) assistantBubble = addBubble("agent", "");
      assistantBubble.textContent += (event as { text: string }).text;
      messages.scrollTop = messages.scrollHeight;
    } else if (event.type === "tool_start") {
      const e = event as Extract<AgentEvent, { type: "tool_start" }>;
      addBubble("tool", `▶ ${e.toolName}`);
    } else if (event.type === "tool_end") {
      const e = event as Extract<AgentEvent, { type: "tool_end" }>;
      addBubble("tool", `${e.isError ? "✗" : "✓"} ${e.toolName}`);
    } else if (event.type === "bridge_error") {
      addBubble("error", (event as { message: string }).message);
      setStreaming(false);
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addBubble("you", text);
    ws.send(JSON.stringify({ type: streaming ? "followUp" : "prompt", text }));
    input.value = "";
    if (!streaming) setStreaming(true);
  });

  steerBtn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) return;
    addBubble("you", `(steer) ${text}`);
    ws.send(JSON.stringify({ type: "steer", text }));
    input.value = "";
  });

  abortBtn.addEventListener("click", () => {
    ws.send(JSON.stringify({ type: "abort" }));
  });

  return {
    dispose() {
      ws.close();
    },
  };
}
