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

export function globalConfigPath(): string {
  return join(serverConfigDir(), "config.json");
}

function fillDefaults(data: Partial<DrejxConfig>): DrejxConfig {
  return {
    serverUrl: data.serverUrl ?? "http://127.0.0.1:8080",
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

/**
 * Resolves, in order: a project-local `drej.config.json` (written by `drejx init`
 * for repos that want their own agents dir / ledger), then a global
 * `~/.config/drejx/config.json`. If neither exists yet, bootstraps the global
 * one so a fresh `bunx drejx` works without requiring `init` in every directory.
 */
export async function readConfig(): Promise<DrejxConfig> {
  const localFile = Bun.file(configPath());
  if (await localFile.exists()) {
    return fillDefaults((await localFile.json()) as Partial<DrejxConfig>);
  }

  const globalPath = globalConfigPath();
  const globalFile = Bun.file(globalPath);
  if (await globalFile.exists()) {
    return fillDefaults((await globalFile.json()) as Partial<DrejxConfig>);
  }

  const dir = serverConfigDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const config: DrejxConfig = {
    serverUrl: "http://127.0.0.1:8080",
    useServerProxy: true,
    apiKey: "",
    adapterPath: join(dir, "ledger.db"),
    agentsDir: join(dir, "agents"),
    defaults: { resources: { cpu: "1000m", memory: "1Gi" } },
  };
  await Bun.write(globalPath, JSON.stringify(config, null, 2) + "\n");
  return config;
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
eip = "http://127.0.0.1:8080"

[runtime]
type = "docker"
execd_image = "opensandbox/execd:v1.0.19"

[docker]
network_mode = "bridge"
`;
}
