import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { wsUrl } from "./api";

export interface TerminalHandle {
  fit(): void;
  dispose(): void;
}

/** Mounts an xterm.js terminal in `container`, bridged to the interactive-exec WS at `wsPath`. */
export function mountTerminal(container: HTMLElement, wsPath: string): TerminalHandle {
  const term = new Terminal({
    convertEol: true,
    fontSize: 13,
    fontFamily: "var(--font-mono)",
    theme: { background: "#111111" },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  const ws = new WebSocket(wsUrl(wsPath));

  const sendResize = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
  };

  ws.addEventListener("open", () => {
    fitAddon.fit();
    sendResize();
  });
  ws.addEventListener("message", (ev) => {
    if (typeof ev.data === "string") term.write(ev.data);
  });
  ws.addEventListener("close", () => {
    term.write("\r\n\x1b[90m[connection closed]\x1b[0m\r\n");
  });

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
  });

  return {
    fit() {
      fitAddon.fit();
      sendResize();
    },
    dispose() {
      ws.close();
      term.dispose();
    },
  };
}
