import type { Server, ServerWebSocket } from "bun";
import * as registry from "../registry";
import type { WSData } from "./types";

/** Route handler for `/ws/sandboxes/:id/metrics` — call from the routes table. */
export function upgradeMetrics(
  req: Request,
  server: Server<WSData>,
  sandboxId: string,
): Response | undefined {
  if (!registry.sandboxes.has(sandboxId)) {
    return Response.json({ error: `Unknown sandbox ${sandboxId}` }, { status: 404 });
  }
  const ok = server.upgrade(req, { data: { kind: "metrics", sandboxId, stop: null } });
  return ok ? undefined : new Response("Upgrade failed", { status: 400 });
}

export async function onOpen(ws: ServerWebSocket<WSData>): Promise<void> {
  if (ws.data.kind !== "metrics") return;
  const sb = registry.sandboxes.get(ws.data.sandboxId);
  if (!sb) {
    ws.close(1011, "sandbox no longer exists");
    return;
  }
  const gen = sb.watchMetrics();
  let stopped = false;
  ws.data.stop = () => {
    stopped = true;
    void gen.return(undefined);
  };

  (async () => {
    try {
      for await (const metrics of gen) {
        if (stopped) break;
        ws.send(JSON.stringify(metrics));
      }
    } catch {
      // connection to execd dropped — let the client reconnect
    }
  })();
}

export function onClose(ws: ServerWebSocket<WSData>): void {
  if (ws.data.kind !== "metrics") return;
  ws.data.stop?.();
}
