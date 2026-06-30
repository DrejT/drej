import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";

export interface DrejxConfig {
  serverUrl: string;
  useServerProxy: boolean;
  apiKey: string;
  adapterPath: string;
  agentsDir: string;
  defaults: {
    resources: { cpu: string; memory: string };
  };
}

const CONFIG_DIR = ".drej";
const CONFIG_FILE = "drej.config.json";

export function configPath(): string {
  return CONFIG_FILE;
}

export async function readConfig(): Promise<DrejxConfig> {
  const file = Bun.file(configPath());
  if (!(await file.exists())) throw new Error("No drej.config.json found — run 'drejx init' first");
  const data = (await file.json()) as Partial<DrejxConfig>;
  return {
    serverUrl: data.serverUrl ?? "http://localhost:8080",
    useServerProxy: data.useServerProxy ?? true,
    apiKey: data.apiKey ?? "",
    adapterPath: data.adapterPath ?? "./.drej/ledger.db",
    agentsDir: data.agentsDir ?? "./agents",
    defaults: {
      resources: {
        cpu: data.defaults?.resources?.cpu ?? "1000m",
        memory: data.defaults?.resources?.memory ?? "1Gi",
      },
    },
  };
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
