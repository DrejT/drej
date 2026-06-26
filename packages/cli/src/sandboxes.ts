import { join } from "path";

export interface SandboxEntry {
  name: string;
  sandboxId: string;
  url: string;
  createdAt: string;
}

const SANDBOXES_FILE = join(".drej", "sandboxes.json");

export async function readSandboxes(): Promise<SandboxEntry[]> {
  const file = Bun.file(SANDBOXES_FILE);
  if (!(await file.exists())) return [];
  return file.json() as Promise<SandboxEntry[]>;
}

export async function writeSandboxes(entries: SandboxEntry[]): Promise<void> {
  await Bun.write(SANDBOXES_FILE, JSON.stringify(entries, null, 2) + "\n");
}
