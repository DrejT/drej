/**
 * A single event emitted by an agent stream. Discriminated on `type`.
 *
 * - `text` — a chunk of Pi's text response (assistant prose)
 * - `tool_start` — Pi started executing a tool (bash, file write, etc.)
 * - `tool_update` — streaming progress from an in-flight tool execution
 * - `tool_end` — a tool finished; `result` holds its output, `isError` whether it failed
 * - `extension_ui` — a Pi extension requested UI interaction; dialog requests are
 *   auto-cancelled by the bridge so Pi never stalls, but the event is forwarded so
 *   callers can observe what was requested
 * - `auto_retry_start` — Pi is about to retry after a transient error (429, 5xx)
 * - `auto_retry_end` — Pi's retry sequence completed (success or exhausted)
 */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_update"; toolCallId: string; toolName: string; partialResult: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | {
      type: "extension_ui";
      method: string;
      params: unknown;
      isDialog: boolean;
      requestId?: string;
    }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      type: "auto_retry_end";
      success: boolean;
      attempt: number;
      finalError?: string;
    };

/**
 * Async iterable of structured agent events. Returned by `Agent.prompt()` and `Agent.bash()`.
 *
 * Use `textOnly()` to filter down to just the text chunks:
 *
 * ```ts
 * for await (const chunk of textOnly(agent.prompt("Hello"))) {
 *   process.stdout.write(chunk);
 * }
 * ```
 *
 * Or iterate the full stream to observe tool calls:
 *
 * ```ts
 * for await (const ev of agent.prompt("Build a widget")) {
 *   if (ev.type === "text") process.stdout.write(ev.text);
 *   else if (ev.type === "tool_start") console.log("Pi is running:", ev.toolName, ev.args);
 *   else if (ev.type === "tool_end") console.log("Tool done, isError:", ev.isError);
 * }
 * ```
 */
export type AgentStream = AsyncIterable<AgentEvent>;

/** Filter an `AgentStream` down to just text chunks. */
export async function* textOnly(stream: AgentStream): AsyncIterable<string> {
  for await (const ev of stream) {
    if (ev.type === "text") yield ev.text;
  }
}

/**
 * @deprecated Use `AgentStream`. `PromptStream` will be removed in a future minor.
 */
export type PromptStream = AsyncIterable<string>;

/** A Pi model as returned by `getAvailableModels`, `setModel`, and `cycleModel`. */
export interface PiModel {
  id: string;
  api: string;
  [key: string]: unknown;
}

/** Thinking (reasoning) level supported by models that have extended thinking. */
export type ThinkingLevel = "none" | "low" | "medium" | "high";

/** A single message in Pi's conversation history, as returned by `getMessages`. */
export interface PiMessage {
  role: "user" | "assistant";
  [key: string]: unknown;
}

/** Result of a `compact` operation. */
export interface CompactResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  estimatedTokensAfter: number;
}
