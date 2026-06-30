/**
 * An async iterable that yields Pi's response text in streaming chunks.
 *
 * Returned by `Agent.prompt()`. Iterate with `for await`:
 *
 * ```ts
 * for await (const chunk of agent.prompt("Hello")) {
 *   process.stdout.write(chunk);
 * }
 * ```
 */
export type PromptStream = AsyncIterable<string>;
