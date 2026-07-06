import { marked } from "marked";
import DOMPurify from "dompurify";
import type { AgentEvent } from "@drej/agent";
import { wsUrl } from "./api";

type BridgeErrorEvent = { type: "bridge_error"; message: string };
type ChatEvent = AgentEvent | BridgeErrorEvent;

marked.setOptions({ breaks: true });

function renderMarkdown(raw: string): string {
  return DOMPurify.sanitize(marked.parse(raw, { async: false }) as string);
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

interface ToolCallEntry {
  details: HTMLDetailsElement;
  summary: HTMLElement;
  argsEl: HTMLElement;
  resultEl: HTMLElement;
  toolName: string;
}

export function mountAgentChat(agentId: string): { dispose(): void } {
  const messages = document.getElementById("chat-messages") as HTMLDivElement;
  const form = document.getElementById("chat-form") as HTMLFormElement;
  const input = document.getElementById("chat-input") as HTMLInputElement;
  const steerBtn = document.getElementById("chat-steer-btn") as HTMLButtonElement;
  const abortBtn = document.getElementById("chat-abort-btn") as HTMLButtonElement;
  const queueBadge = document.getElementById("chat-queue-badge") as HTMLSpanElement | null;

  let streaming = false;
  let assistantBubble: HTMLDivElement | null = null;
  let assistantRawText = "";
  let renderScheduled = false;
  const toolCalls = new Map<string, ToolCallEntry>();

  function setStreaming(value: boolean) {
    streaming = value;
    steerBtn.disabled = !streaming;
    abortBtn.disabled = !streaming;
    assistantBubble = null;
    assistantRawText = "";
  }

  function scrollToBottomIfNear(wasNearBottom: boolean) {
    if (wasNearBottom) messages.scrollTop = messages.scrollHeight;
  }

  function addBubble(role: "you" | "agent" | "error" | "system", text: string): HTMLDivElement {
    const wasNearBottom = isNearBottom(messages);
    const bubble = document.createElement("div");
    bubble.className =
      role === "you"
        ? "self-end rounded-lg bg-[var(--color-accent)] px-3 py-2 text-white"
        : role === "error"
          ? "rounded-lg border border-[var(--color-danger)] px-3 py-2 text-[var(--color-danger)]"
          : role === "system"
            ? "mono system-note px-1 text-xs text-[var(--color-muted)] italic"
            : "chat-markdown rounded-lg border border-[var(--color-border)] px-3 py-2";
    bubble.textContent = text;
    messages.appendChild(bubble);
    scrollToBottomIfNear(wasNearBottom);
    return bubble;
  }

  function addCopyButtons(container: HTMLElement) {
    for (const pre of container.querySelectorAll("pre")) {
      if (pre.querySelector(".copy-btn")) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-btn";
      btn.textContent = "Copy";
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
        void navigator.clipboard.writeText(code).then(() => {
          btn.textContent = "Copied";
          setTimeout(() => (btn.textContent = "Copy"), 1200);
        });
      });
      pre.appendChild(btn);
    }
  }

  function scheduleAssistantRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      if (!assistantBubble) return;
      const wasNearBottom = isNearBottom(messages);
      assistantBubble.innerHTML = renderMarkdown(assistantRawText);
      addCopyButtons(assistantBubble);
      scrollToBottomIfNear(wasNearBottom);
    });
  }

  function appendText(text: string) {
    if (!assistantBubble) {
      assistantBubble = document.createElement("div");
      assistantBubble.className =
        "chat-markdown rounded-lg border border-[var(--color-border)] px-3 py-2";
      messages.appendChild(assistantBubble);
      assistantRawText = "";
    }
    assistantRawText += text;
    scheduleAssistantRender();
  }

  function ensureToolCall(toolCallId: string, toolName: string, args: unknown): ToolCallEntry {
    let entry = toolCalls.get(toolCallId);
    if (entry) return entry;

    const wasNearBottom = isNearBottom(messages);
    const details = document.createElement("details");
    details.className =
      "tool-call rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs";
    const summary = document.createElement("summary");
    summary.className = "mono cursor-pointer text-[var(--color-muted)]";
    summary.textContent = `▶ ${toolName}`;
    const argsEl = document.createElement("pre");
    argsEl.className = "mono mt-2 whitespace-pre-wrap break-all text-[var(--color-muted)]";
    argsEl.textContent = JSON.stringify(args, null, 2);
    const resultEl = document.createElement("pre");
    resultEl.className = "mono mt-2 hidden whitespace-pre-wrap break-all text-[var(--color-muted)]";
    details.append(summary, argsEl, resultEl);
    messages.appendChild(details);
    scrollToBottomIfNear(wasNearBottom);

    entry = { details, summary, argsEl, resultEl, toolName };
    toolCalls.set(toolCallId, entry);
    return entry;
  }

  function setQueueBadge(steering: number, followUp: number) {
    if (!queueBadge) return;
    const total = steering + followUp;
    queueBadge.textContent = total > 0 ? `${total} queued` : "";
  }

  const ws = new WebSocket(wsUrl(`/ws/agents/${agentId}/chat`));

  ws.addEventListener("message", (ev) => {
    if (typeof ev.data !== "string") return;
    const event = JSON.parse(ev.data) as ChatEvent;

    switch (event.type) {
      case "agent_start": {
        setStreaming(true);
        break;
      }
      case "agent_end": {
        setStreaming(false);
        break;
      }
      case "text": {
        appendText(event.text);
        break;
      }
      case "tool_start": {
        ensureToolCall(event.toolCallId, event.toolName, event.args);
        break;
      }
      case "tool_update": {
        const entry = ensureToolCall(event.toolCallId, event.toolName, {});
        entry.resultEl.classList.remove("hidden");
        entry.resultEl.textContent = `--- partial ---\n${JSON.stringify(event.partialResult, null, 2)}`;
        break;
      }
      case "tool_end": {
        const entry = ensureToolCall(event.toolCallId, event.toolName, {});
        entry.summary.textContent = `${event.isError ? "✗" : "✓"} ${entry.toolName}`;
        entry.resultEl.classList.remove("hidden");
        entry.resultEl.textContent = `--- result ---\n${JSON.stringify(event.result, null, 2)}`;
        break;
      }
      case "auto_retry_start": {
        addBubble(
          "system",
          `Retrying (attempt ${event.attempt}/${event.maxAttempts})… ${event.errorMessage}`,
        );
        break;
      }
      case "auto_retry_end": {
        addBubble(
          "system",
          event.success
            ? "Retry succeeded"
            : `Retry failed: ${event.finalError ?? "unknown error"}`,
        );
        break;
      }
      case "compaction_start": {
        addBubble("system", "Compacting context…");
        break;
      }
      case "compaction_end": {
        if (!event.aborted && event.result) {
          addBubble(
            "system",
            `Context compacted (${event.result.tokensBefore} → ${event.result.estimatedTokensAfter} tokens)`,
          );
        }
        break;
      }
      case "extension_error": {
        addBubble("error", `Extension error (${event.extensionPath}): ${event.error}`);
        break;
      }
      case "extension_ui": {
        if (event.isDialog) {
          addBubble("system", `Agent requested UI (${event.method}), auto-dismissed`);
        }
        break;
      }
      case "queue_update": {
        setQueueBadge(event.steering.length, event.followUp.length);
        break;
      }
      case "bridge_error": {
        addBubble("error", event.message);
        setStreaming(false);
        break;
      }
      default:
        break;
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
