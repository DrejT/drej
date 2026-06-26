import { readSandboxes } from "../sandboxes.js";

export async function list(): Promise<void> {
  const entries = await readSandboxes();
  if (entries.length === 0) {
    console.log("No sandboxes found. Run 'drejx add <url>' to provision one.");
    return;
  }

  const now = Date.now();
  const cols = [20, 18, 6, 0] as const;
  const header = ["NAME", "SANDBOX ID", "AGE", "URL"];
  console.log(header.map((h, i) => (cols[i] ? h.padEnd(cols[i]) : h)).join("  "));
  console.log("-".repeat(70));

  for (const e of entries) {
    const ageSec = Math.floor((now - new Date(e.createdAt).getTime()) / 1_000);
    const age =
      ageSec < 60
        ? `${ageSec}s`
        : ageSec < 3_600
          ? `${Math.floor(ageSec / 60)}m`
          : `${Math.floor(ageSec / 3_600)}h`;
    const row = [e.name, e.sandboxId.slice(0, 16), age, e.url];
    console.log(row.map((v, i) => (cols[i] ? v.padEnd(cols[i]) : v)).join("  "));
  }
}
