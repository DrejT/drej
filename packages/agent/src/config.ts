import { existsSync } from "fs";

export interface DrejAgentConfig {
  serverUrl: string;
  apiKey: string;
  adapterPath: string;
  useServerProxy: boolean;
  agentsDir: string;
  defaults: {
    resources: { cpu: string; memory: string };
  };
}

const CONFIG_FILE = "drej.config.json";

const DEFAULT_CONFIG: DrejAgentConfig = {
  serverUrl: "http://localhost:8080",
  apiKey: "",
  adapterPath: "./.drej/ledger.db",
  useServerProxy: true,
  agentsDir: "./agents",
  defaults: {
    resources: { cpu: "1000m", memory: "1Gi" },
  },
};

export async function readProjectConfig(): Promise<DrejAgentConfig> {
  if (!existsSync(CONFIG_FILE)) return DEFAULT_CONFIG;
  const data = (await Bun.file(CONFIG_FILE).json()) as Partial<DrejAgentConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...data,
    defaults: {
      ...DEFAULT_CONFIG.defaults,
      ...(data.defaults ?? {}),
      resources: {
        ...DEFAULT_CONFIG.defaults.resources,
        ...(data.defaults?.resources ?? {}),
      },
    },
  };
}
