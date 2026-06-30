/**
 * An async iterable that yields Pi's response text in streaming chunks.
 *
 * Returned by `Agent.prompt()` and `Agent.bash()`. Iterate with `for await`:
 *
 * ```ts
 * for await (const chunk of agent.prompt("Hello")) {
 *   process.stdout.write(chunk);
 * }
 * ```
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
