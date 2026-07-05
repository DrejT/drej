import * as registry from "../registry";
import { CapacityError, NotFoundError } from "../registry";
import * as config from "../config";

function errorResponse(err: unknown): Response {
  if (err instanceof CapacityError) return Response.json({ error: err.message }, { status: 409 });
  if (err instanceof NotFoundError) return Response.json({ error: err.message }, { status: 404 });
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message }, { status: 500 });
}

export async function listAgents(): Promise<Response> {
  const list = Array.from(registry.agents.values()).map((agent) => ({
    id: agent.sandboxId,
    name: agent.name,
  }));
  return Response.json({
    agents: list,
    max: config.MAX_AGENTS,
    allowedSpecs: config.ALLOWED_AGENT_SPECS,
  });
}

export async function createAgent(specName: string): Promise<Response> {
  try {
    const agent = await registry.createAgent(specName);
    return Response.json({ id: agent.sandboxId, name: agent.name }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function deleteAgent(id: string): Promise<Response> {
  try {
    await registry.deleteAgent(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function getMessages(id: string): Promise<Response> {
  try {
    const agent = registry.agents.get(id);
    if (!agent) throw new NotFoundError(`Unknown agent ${id}`);
    const messages = await agent.getMessages();
    return Response.json({ messages });
  } catch (err) {
    return errorResponse(err);
  }
}
