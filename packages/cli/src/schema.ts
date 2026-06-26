export interface RegistryItem {
  name: string;
  title?: string;
  description?: string;
  author?: string;
  categories?: string[];
  image: string | { uri: string; auth?: { username: string; password: string } };
  resources: { cpu: string; memory: string; gpu?: string };
  env?: Record<string, string>;
  setup?: string[];
  snapshotId?: string;
  ports?: number[];
  metadata?: Record<string, string>;
  registryDependencies?: string[];
}

export function validateRegistryItem(data: unknown): RegistryItem {
  if (!data || typeof data !== "object") throw new Error("Registry item must be an object");
  const item = data as Record<string, unknown>;
  if (typeof item.name !== "string" || !item.name)
    throw new Error("Registry item must have a 'name' string");
  if (item.image === undefined || item.image === null)
    throw new Error("Registry item must have an 'image'");
  if (typeof item.image !== "string" && typeof item.image !== "object")
    throw new Error("'image' must be a string or { uri: string }");
  if (!item.resources || typeof item.resources !== "object")
    throw new Error("Registry item must have 'resources'");
  const res = item.resources as Record<string, unknown>;
  if (typeof res.cpu !== "string") throw new Error("'resources.cpu' must be a string");
  if (typeof res.memory !== "string") throw new Error("'resources.memory' must be a string");
  return item as unknown as RegistryItem;
}
