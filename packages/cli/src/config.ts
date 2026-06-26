import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";

export interface DrejxConfig {
  serverUrl: string;
  useServerProxy: boolean;
  apiKey: string;
  adapterPath: string;
}

const CONFIG_DIR = ".drej";

export function configPath(): string {
  return join(CONFIG_DIR, "config.json");
}

export async function readConfig(): Promise<DrejxConfig> {
  const file = Bun.file(configPath());
  if (!(await file.exists()))
    throw new Error("No .drej/config.json found — run 'drejx init' first");
  return file.json() as Promise<DrejxConfig>;
}

export async function writeConfig(config: DrejxConfig): Promise<void> {
  if (!existsSync(CONFIG_DIR)) await mkdir(CONFIG_DIR, { recursive: true });
  await Bun.write(configPath(), JSON.stringify(config, null, 2) + "\n");
}

export function serverConfigDir(): string {
  return join(homedir(), ".config", "drejx");
}

export function serverConfigPath(): string {
  return join(serverConfigDir(), "server.toml");
}

export function serverConfigContent(): string {
  return `[server]
host = "0.0.0.0"
port = 8080
eip = "http://localhost:8080"

[runtime]
type = "docker"
execd_image = "opensandbox/execd:v1.0.19"

[docker]
network_mode = "bridge"
`;
}
