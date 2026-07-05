import type { Server, ServerWebSocket } from "bun";
import type { AgentStream } from "@drej/agent";
import * as registry from "../registry";
import type { WSData } from "./types";

type ChatCommand =
  | { type: "prompt"; text: string }
  | { type: "steer"; text: string }
  | { type: "followUp"; text: string }
  | { type: "abort" };

/** Route handler for `/ws/agents/:id/chat` — call from the routes table. */
export function upgradeChat(
  req: Request,
  server: Server<WSData>,
  agentId: string,
): Response | undefined {
  if (!registry.agents.has(agentId)) {
    return Response.json({ error: `Unknown agent ${agentId}` }, { status: 404 });
  }
  const ok = server.upgrade(req, { data: { kind: "chat", agentId, streaming: false } });
  return ok ? undefined : new Response("Upgrade failed", { status: 400 });
}

async function streamEvents(
  ws: ServerWebSocket<WSData>,
  data: Extract<WSData, { kind: "chat" }>,
  stream: AgentStream,
): Promise<void> {
  data.streaming = true;
  try {
    for await (const event of stream) {
      ws.send(JSON.stringify(event));
    }
  } catch (err) {
    ws.send(JSON.stringify({ type: "bridge_error", message: String(err) }));
  } finally {
    data.streaming = false;
  }
}

export function onMessage(
  ws: ServerWebSocket<WSData>,
  message: string | Buffer<ArrayBuffer>,
): void {
  if (ws.data.kind !== "chat") return;
  const data = ws.data;
  const agent = registry.agents.get(data.agentId);
  if (!agent) {
    ws.close(1011, "agent no longer exists");
    return;
  }
  const text = typeof message === "string" ? message : message.toString("utf-8");
  let cmd: ChatCommand;
  try {
    cmd = JSON.parse(text) as ChatCommand;
  } catch {
    return;
  }

  if (cmd.type === "prompt") {
    if (data.streaming) return; // use steer()/followUp() to interject, not a second prompt()
    void streamEvents(ws, data, agent.prompt(cmd.text));
  } else if (cmd.type === "steer") {
    void agent.steer(cmd.text);
  } else if (cmd.type === "followUp") {
    void agent.followUp(cmd.text);
  } else if (cmd.type === "abort") {
    void agent.abort();
  }
}

export function onClose(ws: ServerWebSocket<WSData>): void {
  if (ws.data.kind !== "chat" || !ws.data.streaming) return;
  const agent = registry.agents.get(ws.data.agentId);
  void agent?.abort();
}
