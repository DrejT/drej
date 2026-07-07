import { createCliRenderer, BoxRenderable } from "@opentui/core";
import type { SandboxDetails } from "drej";
import { Agent } from "@drej/agent";
import { SQLiteAdapter } from "@drej/sqlite";
import { readConfig } from "../config.js";
import { createDashboardView, type DashboardView } from "./dashboard.js";
import { createChatView, type ChatView } from "./chat.js";

export async function launchTui(): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  const root = new BoxRenderable(renderer, { id: "tui-root", width: "100%", height: "100%" });
  renderer.root.add(root);

  let current: DashboardView | ChatView | null = null;

  function mount(view: DashboardView | ChatView): void {
    if (current) {
      root.remove(current.box);
      current.dispose();
    }
    current = view;
    root.add(view.box);
  }

  function quit(): void {
    renderer.destroy();
    process.exit(0);
  }

  function showDashboard(initialStatus?: string): void {
    const view = createDashboardView(renderer, (session) => void openSession(session), quit);
    mount(view);
    if (initialStatus) view.setStatus(initialStatus);
  }

  async function openSession(session: SandboxDetails): Promise<void> {
    const config = await readConfig();
    const adapter = new SQLiteAdapter(config.adapterPath);
    try {
      const agent = await Agent.resume(session.sandboxId, {
        adapter,
        specPath: `${config.agentsDir}/${session.name}.json`,
      });
      mount(createChatView(renderer, agent, () => showDashboard()));
    } catch (err) {
      showDashboard(
        `failed to open '${session.name}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  showDashboard();
  renderer.start();
}
