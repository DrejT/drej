import { api, type SandboxSummary, type AgentSummary } from "./api";
import { mountTerminal, type TerminalHandle } from "./terminal";
import { mountFileBrowser } from "./fileBrowser";
import { mountMetricsChart, type MetricsHandle } from "./metricsChart";
import { mountAgentChat } from "./agentChat";

const dashboard = document.getElementById("dashboard") as HTMLElement;
const sandboxPanel = document.getElementById("sandbox-panel") as HTMLElement;
const agentPanel = document.getElementById("agent-panel") as HTMLElement;

const sandboxList = document.getElementById("sandbox-list") as HTMLUListElement;
const sandboxCount = document.getElementById("sandbox-count") as HTMLElement;
const sandboxEmpty = document.getElementById("sandbox-empty") as HTMLElement;
const newSandboxBtn = document.getElementById("new-sandbox-btn") as HTMLButtonElement;

const agentList = document.getElementById("agent-list") as HTMLUListElement;
const agentCount = document.getElementById("agent-count") as HTMLElement;
const agentEmpty = document.getElementById("agent-empty") as HTMLElement;
const newAgentBtn = document.getElementById("new-agent-btn") as HTMLButtonElement;
const agentSpecSelect = document.getElementById("agent-spec-select") as HTMLSelectElement;

let currentTerminal: TerminalHandle | null = null;
let currentMetrics: MetricsHandle | null = null;
let disposeFileBrowser: (() => void) | null = null;
let disposeAgentChat: (() => void) | null = null;
let currentAgentShell: TerminalHandle | null = null;

async function refreshDashboard(): Promise<void> {
  const [sandboxesRes, agentsRes] = await Promise.all([api.listSandboxes(), api.listAgents()]);

  sandboxCount.textContent = `${sandboxesRes.sandboxes.length}/${sandboxesRes.max}`;
  sandboxList.innerHTML = "";
  sandboxEmpty.hidden = sandboxesRes.sandboxes.length > 0;
  newSandboxBtn.disabled = sandboxesRes.sandboxes.length >= sandboxesRes.max;
  for (const sb of sandboxesRes.sandboxes) sandboxList.appendChild(renderSandboxCard(sb));

  agentCount.textContent = `${agentsRes.agents.length}/${agentsRes.max}`;
  agentList.innerHTML = "";
  agentEmpty.hidden = agentsRes.agents.length > 0;
  newAgentBtn.disabled = agentsRes.agents.length >= agentsRes.max;
  for (const agent of agentsRes.agents) agentList.appendChild(renderAgentCard(agent));
}

function renderCard(
  name: string,
  onOpen: () => void,
  onDelete: () => Promise<void>,
): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "card flex items-center justify-between";

  const left = document.createElement("div");
  const dot = document.createElement("span");
  dot.className = "status-dot mr-2";
  const label = document.createElement("span");
  label.className = "mono text-sm";
  label.textContent = name;
  left.append(dot, label);

  const right = document.createElement("div");
  right.className = "flex gap-2";
  const openBtn = document.createElement("button");
  openBtn.className = "btn";
  openBtn.textContent = "Open";
  openBtn.addEventListener("click", onOpen);
  const delBtn = document.createElement("button");
  delBtn.className = "btn btn-danger";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", () => {
    delBtn.disabled = true;
    void onDelete().catch((err) => {
      alert(String(err));
      delBtn.disabled = false;
    });
  });
  right.append(openBtn, delBtn);

  li.append(left, right);
  return li;
}

function renderSandboxCard(sb: SandboxSummary): HTMLLIElement {
  return renderCard(
    sb.name,
    () => openSandboxPanel(sb),
    async () => {
      await api.deleteSandbox(sb.id);
      await refreshDashboard();
    },
  );
}

function renderAgentCard(agent: AgentSummary): HTMLLIElement {
  return renderCard(
    agent.name,
    () => openAgentPanel(agent),
    async () => {
      await api.deleteAgent(agent.id);
      await refreshDashboard();
    },
  );
}

function disposeSandboxPanel(): void {
  currentTerminal?.dispose();
  currentTerminal = null;
  currentMetrics?.dispose();
  currentMetrics = null;
  disposeFileBrowser?.();
  disposeFileBrowser = null;
}

function disposeAgentPanel(): void {
  disposeAgentChat?.();
  disposeAgentChat = null;
  currentAgentShell?.dispose();
  currentAgentShell = null;
}

function showDashboard(): void {
  disposeSandboxPanel();
  disposeAgentPanel();
  dashboard.hidden = false;
  sandboxPanel.hidden = true;
  agentPanel.hidden = true;
  void refreshDashboard();
}

function wireTabs(panel: HTMLElement, onShow: (tab: string) => void): void {
  const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>(".tab-btn"));
  const contents = Array.from(panel.querySelectorAll<HTMLElement>("[data-tab-content]"));
  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      for (const b of buttons) b.classList.toggle("active", b === btn);
      for (const c of contents) c.hidden = c.dataset.tabContent !== btn.dataset.tab;
      onShow(btn.dataset.tab ?? "");
    });
  }
  buttons[0]?.classList.add("active");
  onShow(buttons[0]?.dataset.tab ?? "");
}

function wireCheckpoints(sandboxId: string): void {
  const list = document.getElementById("checkpoint-list") as HTMLUListElement;
  const createBtn = document.getElementById("checkpoint-create-btn") as HTMLButtonElement;

  async function refresh() {
    list.innerHTML = "";
    const { checkpoints } = await api.listCheckpoints(sandboxId);
    for (const cp of checkpoints) {
      const li = document.createElement("li");
      li.textContent = `${new Date(cp.createdAt).toLocaleString()} — ${cp.snapshotId}${cp.tag ? ` (${cp.tag})` : ""}`;
      list.appendChild(li);
    }
  }

  const freshCreateBtn = createBtn.cloneNode(true) as HTMLButtonElement;
  createBtn.replaceWith(freshCreateBtn);
  freshCreateBtn.addEventListener("click", async () => {
    freshCreateBtn.disabled = true;
    try {
      await api.createCheckpoint(sandboxId);
      await refresh();
    } finally {
      freshCreateBtn.disabled = false;
    }
  });

  void refresh();
}

function wirePreview(sandboxId: string): void {
  const portInput = document.getElementById("preview-port-input") as HTMLInputElement;
  const loadBtn = document.getElementById("preview-load-btn") as HTMLButtonElement;
  const frame = document.getElementById("preview-frame") as HTMLIFrameElement;

  const freshLoadBtn = loadBtn.cloneNode(true) as HTMLButtonElement;
  loadBtn.replaceWith(freshLoadBtn);
  freshLoadBtn.addEventListener("click", async () => {
    const port = Number(portInput.value);
    if (!port) return;
    const { url } = await api.getPreview(sandboxId, port);
    frame.src = url;
  });
}

function openSandboxPanel(sb: SandboxSummary): void {
  disposeSandboxPanel();
  dashboard.hidden = true;
  agentPanel.hidden = true;
  sandboxPanel.hidden = false;

  const title = document.getElementById("sandbox-panel-title") as HTMLElement;
  title.textContent = `${sb.name} — ${sb.id}`;

  const terminalContainer = document.getElementById("terminal-container") as HTMLElement;
  currentTerminal = mountTerminal(terminalContainer, `/ws/sandboxes/${sb.id}/terminal`);
  disposeFileBrowser = mountFileBrowser(sb.id).dispose;

  const metricsCanvas = document.getElementById("metrics-chart") as HTMLCanvasElement;
  const metricsReadout = document.getElementById("metrics-readout") as HTMLElement;
  currentMetrics = mountMetricsChart(metricsCanvas, metricsReadout, sb.id);

  wireCheckpoints(sb.id);
  wirePreview(sb.id);

  wireTabs(sandboxPanel, (tab) => {
    if (tab === "terminal") currentTerminal?.fit();
    if (tab === "metrics") currentMetrics?.resize();
  });
}

function openAgentPanel(agent: AgentSummary): void {
  disposeAgentPanel();
  dashboard.hidden = true;
  sandboxPanel.hidden = true;
  agentPanel.hidden = false;

  const title = document.getElementById("agent-panel-title") as HTMLElement;
  title.textContent = `${agent.name} — ${agent.id}`;

  document.getElementById("chat-messages")!.innerHTML = "";
  disposeAgentChat = mountAgentChat(agent.id).dispose;

  const shellContainer = document.getElementById("agent-terminal-container") as HTMLElement;

  wireTabs(agentPanel, (tab) => {
    if (tab === "shell" && !currentAgentShell) {
      currentAgentShell = mountTerminal(shellContainer, `/ws/agents/${agent.id}/shell`);
    } else if (tab === "shell") {
      currentAgentShell?.fit();
    }
  });
}

(document.getElementById("sandbox-panel-back") as HTMLButtonElement).addEventListener(
  "click",
  showDashboard,
);
(document.getElementById("agent-panel-back") as HTMLButtonElement).addEventListener(
  "click",
  showDashboard,
);

newSandboxBtn.addEventListener("click", async () => {
  newSandboxBtn.disabled = true;
  try {
    await api.createSandbox();
    await refreshDashboard();
  } catch (err) {
    alert(String(err));
  } finally {
    newSandboxBtn.disabled = false;
  }
});

newAgentBtn.addEventListener("click", async () => {
  newAgentBtn.disabled = true;
  try {
    await api.createAgent(agentSpecSelect.value);
    await refreshDashboard();
  } catch (err) {
    alert(String(err));
  } finally {
    newAgentBtn.disabled = false;
  }
});

void refreshDashboard();
