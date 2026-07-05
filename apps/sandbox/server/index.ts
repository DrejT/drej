import { join, extname } from "path";
import * as config from "./config";
import * as registry from "./registry";
import * as sandboxRoutes from "./routes/sandboxes";
import * as agentRoutes from "./routes/agents";
import * as terminal from "./ws/terminal";
import * as metrics from "./ws/metrics";
import * as chat from "./ws/chat";
import type { WSData } from "./ws/types";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function serveStatic(pathname: string): Promise<Response> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = join(config.DIST_DIR, safePath);
  let file = Bun.file(filePath);
  if (!(await file.exists())) {
    file = Bun.file(join(config.DIST_DIR, "index.html"));
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
  }
  const type = CONTENT_TYPES[extname(filePath)];
  return new Response(file, type ? { headers: { "Content-Type": type } } : undefined);
}

const server = Bun.serve({
  port: config.PORT,
  routes: {
    "/api/sandboxes": {
      GET: () => sandboxRoutes.listSandboxes(),
      POST: () => sandboxRoutes.createSandbox(),
    },
    "/api/sandboxes/:id": {
      DELETE: (req) => sandboxRoutes.deleteSandbox(req.params.id),
    },
    "/api/sandboxes/:id/files": {
      GET: (req) =>
        sandboxRoutes.listDirectory(
          req.params.id,
          new URL(req.url).searchParams.get("path") ?? "/",
        ),
    },
    "/api/sandboxes/:id/file": {
      GET: (req) => {
        const path = new URL(req.url).searchParams.get("path");
        if (!path) return Response.json({ error: "missing ?path=" }, { status: 400 });
        return sandboxRoutes.readFile(req.params.id, path);
      },
      PUT: async (req) => {
        const path = new URL(req.url).searchParams.get("path");
        if (!path) return Response.json({ error: "missing ?path=" }, { status: 400 });
        const content = await req.text();
        return sandboxRoutes.writeFile(req.params.id, path, content);
      },
    },
    "/api/sandboxes/:id/metrics": {
      GET: (req) => sandboxRoutes.getMetrics(req.params.id),
    },
    "/api/sandboxes/:id/checkpoints": {
      GET: (req) => sandboxRoutes.listCheckpoints(req.params.id),
    },
    "/api/sandboxes/:id/checkpoint": {
      POST: (req) => sandboxRoutes.createCheckpoint(req.params.id),
    },
    "/api/sandboxes/:id/preview": {
      GET: (req) => {
        const port = Number(new URL(req.url).searchParams.get("port"));
        if (!port) return Response.json({ error: "missing ?port=" }, { status: 400 });
        return sandboxRoutes.getPreview(req.params.id, port);
      },
    },
    "/api/agents": {
      GET: () => agentRoutes.listAgents(),
      POST: async (req) => {
        const body = (await req.json().catch(() => ({}))) as { specName?: string };
        if (!body.specName) return Response.json({ error: "missing specName" }, { status: 400 });
        return agentRoutes.createAgent(body.specName);
      },
    },
    "/api/agents/:id": {
      DELETE: (req) => agentRoutes.deleteAgent(req.params.id),
    },
    "/api/agents/:id/messages": {
      GET: (req) => agentRoutes.getMessages(req.params.id),
    },
    "/ws/sandboxes/:id/terminal": (req, srv) => terminal.upgradeTerminal(req, srv, req.params.id),
    "/ws/sandboxes/:id/metrics": (req, srv) => metrics.upgradeMetrics(req, srv, req.params.id),
    "/ws/agents/:id/chat": (req, srv) => chat.upgradeChat(req, srv, req.params.id),
    "/ws/agents/:id/shell": (req, srv) => terminal.upgradeAgentShell(req, srv, req.params.id),
  },
  websocket: {
    data: {} as WSData,
    open(ws) {
      if (ws.data.kind === "terminal") void terminal.onOpen(ws);
      else if (ws.data.kind === "metrics") void metrics.onOpen(ws);
    },
    message(ws, message) {
      if (ws.data.kind === "terminal") terminal.onMessage(ws, message);
      else if (ws.data.kind === "chat") chat.onMessage(ws, message);
    },
    close(ws) {
      if (ws.data.kind === "terminal") void terminal.onClose(ws);
      else if (ws.data.kind === "metrics") metrics.onClose(ws);
      else if (ws.data.kind === "chat") chat.onClose(ws);
    },
  },
  fetch: (req) => serveStatic(new URL(req.url).pathname),
});

await registry.reconcile();

console.log(`[sandbox] listening on http://localhost:${server.port}`);
