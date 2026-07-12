import { ExecClient } from "@drej/opensandbox";
import type { ControlClient } from "@drej/opensandbox";
import { ExecConnectionError } from "../errors";

/**
 * Resolve an ExecClient for a sandbox. Calls getEndpoint once (each call
 * returns a different ephemeral proxy port) then polls listContexts until
 * execd is ready to accept connections.
 */
export async function resolveExecClient(
  control: ControlClient,
  sandboxId: string,
  useServerProxy?: boolean,
  retries = 15,
  delayMs = 1_000,
): Promise<ExecClient> {
  const ep = await control.getEndpoint(sandboxId, 44772, useServerProxy);
  const baseUrl = ep.endpoint.startsWith("http") ? ep.endpoint : `http://${ep.endpoint}`;
  const token = ep.headers?.["X-EXECD-ACCESS-TOKEN"] ?? "";
  const client = new ExecClient({ baseUrl, accessToken: token });
  // Starts fast and backs off to delayMs — execd is usually ready well under one
  // fixed-interval tick, so a flat wait here was pure waste in the common case.
  let delay = Math.min(100, delayMs);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await client.listContexts();
      return client;
    } catch {
      if (attempt === retries) throw new ExecConnectionError(sandboxId);
      await new Promise<void>((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, delayMs);
    }
  }
  throw new Error("unreachable");
}
