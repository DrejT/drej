import {
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type CliRenderer,
  type SelectOption,
} from "@opentui/core";
import type { SandboxDetails } from "drej";
import { getSessions, formatAge } from "../sessions-data.js";

export interface DashboardView {
  box: BoxRenderable;
  setStatus(message: string): void;
  dispose(): void;
}

export function createDashboardView(
  renderer: CliRenderer,
  onOpen: (session: SandboxDetails) => void,
  onQuit: () => void,
): DashboardView {
  const box = new BoxRenderable(renderer, {
    id: "dashboard",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
  });

  box.add(
    new TextRenderable(renderer, {
      id: "dashboard-title",
      content: "drejx — sessions   (↑/↓ move · enter open · r refresh · q quit)",
    }),
  );

  const select = new SelectRenderable(renderer, {
    id: "dashboard-select",
    width: "100%",
    height: "100%",
    options: [],
  });
  box.add(select);
  select.focus();

  const status = new TextRenderable(renderer, { id: "dashboard-status", content: "loading..." });
  box.add(status);

  async function refresh(): Promise<void> {
    status.content = "refreshing...";
    const { tracked, untracked } = await getSessions();

    const options: SelectOption[] = tracked.map((s) => ({
      name: `${s.name}  ${s.sandboxId.slice(0, 8)}`,
      description: `${formatAge(s.startedAt)} · ${s.execCount} execs`,
      value: s,
    }));
    select.options =
      options.length > 0
        ? options
        : [
            {
              name: "(no running sessions)",
              description: "run 'drejx run <spec>' to start one",
              value: null,
            },
          ];

    status.content =
      untracked.length > 0
        ? `${tracked.length} tracked · ${untracked.length} untracked (agent-spawned) sandboxes running`
        : `${tracked.length} tracked session(s) running`;
  }

  select.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: SelectOption) => {
    if (option.value) onOpen(option.value as SandboxDetails);
  });

  const onKeypress = (event: { name: string }) => {
    if (event.name === "q") onQuit();
    else if (event.name === "r") void refresh();
  };
  renderer.keyInput.on("keypress", onKeypress);

  void refresh();

  return {
    box,
    setStatus(message: string) {
      status.content = message;
    },
    dispose() {
      renderer.keyInput.off("keypress", onKeypress);
    },
  };
}
