export interface AgentSpec {
  $schema?: string;
  name: string;
  title?: string;
  description?: string;
  author?: string;
  categories?: string[];
  cli: "pi";
  cliVersion?: string;
  provider?: string;
  model?: string;
  packages?: string[];
  env?: Record<string, string>;
  resources?: { cpu: string; memory: string; gpu?: string };
  metadata?: Record<string, string>;
  registryDependencies?: string[];
}

export function validateAgentSpec(data: unknown): AgentSpec {
  if (!data || typeof data !== "object") throw new Error("Agent spec must be an object");
  const item = data as Record<string, unknown>;
  if (typeof item.name !== "string" || !item.name)
    throw new Error("Agent spec must have a 'name' string");
  if (item.cli !== "pi")
    throw new Error(
      `Unsupported CLI: '${String(item.cli ?? "(missing)")}'. Supported values: pi`,
    );
  return item as unknown as AgentSpec;
}
