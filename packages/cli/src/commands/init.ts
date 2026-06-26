import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import {
  checkDocker,
  getContainerState,
  startContainer,
  runContainer,
  pollHealth,
} from "../docker.js";
import {
  configPath,
  writeConfig,
  serverConfigDir,
  serverConfigPath,
  serverConfigContent,
} from "../config.js";

const CONTAINER_NAME = "drejx-opensandbox";
const SERVER_URL = "http://localhost:8080";

export async function init(): Promise<void> {
  console.log("Checking Docker...");
  await checkDocker();

  const state = await getContainerState(CONTAINER_NAME);

  if (state === "running") {
    console.log(`OpenSandbox already running at ${SERVER_URL}`);
    await ensureProjectConfig();
    return;
  }

  if (state === "stopped") {
    console.log("Restarting OpenSandbox container...");
    await startContainer(CONTAINER_NAME);
  } else {
    await ensureServerConfig();
    console.log("Starting OpenSandbox in Docker...");
    await runContainer([
      "-d",
      "--name",
      CONTAINER_NAME,
      "-p",
      "8080:8080",
      "-v",
      "/var/run/docker.sock:/var/run/docker.sock",
      "-v",
      `${serverConfigPath()}:/etc/opensandbox/config.toml:ro`,
      "-e",
      "SANDBOX_CONFIG_PATH=/etc/opensandbox/config.toml",
      "-e",
      "OPENSANDBOX_INSECURE_SERVER=YES",
      "opensandbox/server:latest",
    ]);
  }

  console.log("Waiting for OpenSandbox to be ready...");
  await pollHealth(`${SERVER_URL}/health`);
  await ensureProjectConfig();
  console.log(`OpenSandbox running at ${SERVER_URL} — ready.`);
}

async function ensureServerConfig(): Promise<void> {
  const dir = serverConfigDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const path = serverConfigPath();
  if (!existsSync(path)) await Bun.write(path, serverConfigContent());
}

async function ensureProjectConfig(): Promise<void> {
  if (!existsSync(configPath())) {
    await writeConfig({
      serverUrl: SERVER_URL,
      useServerProxy: true,
      apiKey: "",
      adapterPath: "./.drej/ledger.db",
    });
  }
}
