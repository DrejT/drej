import * as registry from "../registry";
import { CapacityError, NotFoundError } from "../registry";
import * as config from "../config";

function errorResponse(err: unknown): Response {
  if (err instanceof CapacityError) return Response.json({ error: err.message }, { status: 409 });
  if (err instanceof NotFoundError) return Response.json({ error: err.message }, { status: 404 });
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message }, { status: 500 });
}

export async function listSandboxes(): Promise<Response> {
  const list = Array.from(registry.sandboxes.values()).map((sb) => ({
    id: sb.sandboxId,
    name: sb.name,
  }));
  return Response.json({ sandboxes: list, max: config.MAX_SANDBOXES });
}

export async function createSandbox(): Promise<Response> {
  try {
    const sb = await registry.createSandbox();
    return Response.json({ id: sb.sandboxId, name: sb.name }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function deleteSandbox(id: string): Promise<Response> {
  try {
    await registry.deleteSandbox(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}

function getSandboxOr404(id: string) {
  const sb = registry.sandboxes.get(id);
  if (!sb) throw new NotFoundError(`Unknown sandbox ${id}`);
  return sb;
}

export async function listDirectory(id: string, path: string): Promise<Response> {
  try {
    const sb = getSandboxOr404(id);
    const entries = await sb.listDirectory(path || "/");
    return Response.json({ entries });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function readFile(id: string, path: string): Promise<Response> {
  try {
    const sb = getSandboxOr404(id);
    const content = await sb.readFile(path);
    return Response.json({ path, content });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function writeFile(id: string, path: string, content: string): Promise<Response> {
  try {
    const sb = getSandboxOr404(id);
    await sb.writeFile(path, content);
    return Response.json({ path });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function getMetrics(id: string): Promise<Response> {
  try {
    const sb = getSandboxOr404(id);
    const metrics = await sb.metrics();
    return Response.json(metrics);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function listCheckpoints(id: string): Promise<Response> {
  try {
    const sb = getSandboxOr404(id);
    const checkpoints = await sb.listCheckpoints();
    return Response.json({ checkpoints });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function createCheckpoint(id: string): Promise<Response> {
  try {
    const sb = getSandboxOr404(id);
    const snapshotId = await sb.checkpoint();
    return Response.json({ snapshotId });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function getPreview(id: string, port: number): Promise<Response> {
  try {
    const sb = getSandboxOr404(id);
    const proxy = await sb.proxy(port);
    return Response.json(proxy);
  } catch (err) {
    return errorResponse(err);
  }
}
