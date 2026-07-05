import { wsUrl } from "./api";

export interface MetricsHandle {
  resize(): void;
  dispose(): void;
}

/** Mounts a minimal live CPU/memory sparkline, wired to the metrics WS. */
export function mountMetricsChart(
  canvas: HTMLCanvasElement,
  readout: HTMLElement,
  sandboxId: string,
): MetricsHandle {
  const ctx = canvas.getContext("2d")!;
  const cpuSamples: number[] = [];
  const memSamples: number[] = [];

  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width));
    canvas.height = Math.max(1, Math.floor(rect.height));
    draw();
  }

  function drawSeries(samples: number[], color: string) {
    if (samples.length < 2) return;
    const max = Math.max(...samples, 0.001);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    samples.forEach((v, i) => {
      const x = (i / (samples.length - 1)) * canvas.width;
      const y = canvas.height - (v / max) * (canvas.height - 8) - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSeries(cpuSamples, "#7c5cff");
    drawSeries(memSamples, "#22c55e");
  }

  const ws = new WebSocket(wsUrl(`/ws/sandboxes/${sandboxId}/metrics`));
  ws.addEventListener("message", (ev) => {
    if (typeof ev.data !== "string") return;
    const m = JSON.parse(ev.data) as { cpu: number; memory: number; timestamp: string };
    cpuSamples.push(m.cpu);
    memSamples.push(m.memory);
    if (cpuSamples.length > 120) cpuSamples.shift();
    if (memSamples.length > 120) memSamples.shift();
    readout.textContent = `cpu ${m.cpu.toFixed(3)} (violet)  ·  memory ${m.memory.toFixed(1)} (green)  ·  ${m.timestamp}`;
    draw();
  });

  return { resize, dispose: () => ws.close() };
}
