import type { Agent } from "@drej/agent";

/** Sends one prompt and collects just the text chunks into a single reply string. */
export async function collectReply(agent: Agent, message: string): Promise<string> {
  let reply = "";
  for await (const ev of agent.prompt(message)) {
    if (ev.type === "text") reply += ev.text;
  }
  return reply;
}
