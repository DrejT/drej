import type { Sandbox } from "@drej/core";
import type { AgentSpec } from "../schema";
import type { PromptStream } from "../types";

// Node.js CJS bridge script — written into the sandbox at /drej-bridge.js and run with `node`.
// Wraps `pi --mode rpc` in an HTTP server so the host can communicate bidirectionally
// without needing interactive stdin support from the sandbox exec API.
//
// Double-escaped for use in a TypeScript template literal:
//   \\n   → \n  (newline in output)
//   \\\\ → \\  (single backslash in output)
const BRIDGE_SCRIPT = `
"use strict";
var spawn = require("child_process").spawn;
var createInterface = require("readline").createInterface;
var http = require("http");
var fs = require("fs");

var PORT = 3001;
var ENV_FILE = "/etc/drej-env";
var PI_CONFIG_FILE = "/etc/drej-pi.json";

// Re-read /etc/drej-env into process.env on each Pi (re)start so setEnv() changes take effect.
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  var lines = fs.readFileSync(ENV_FILE, "utf8").split("\\n");
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^export ([A-Za-z_][A-Za-z0-9_]*)="((?:[^"\\\\]|\\\\.)*)"$/);
    if (m) process.env[m[1]] = m[2].replace(/\\\\"/g, '"').replace(/\\\\\\\\/g, "\\\\");
  }
}

// Build the pi CLI args from /etc/drej-pi.json (model/provider config, written by the host).
function buildPiArgs() {
  var args = ["--mode", "rpc", "--approve"];
  try {
    if (fs.existsSync(PI_CONFIG_FILE)) {
      var cfg = JSON.parse(fs.readFileSync(PI_CONFIG_FILE, "utf8"));
      if (cfg.provider) args.push("--provider", cfg.provider);
      if (cfg.model) args.push("--model", cfg.model);
    }
  } catch (e) {}
  return args;
}

// --- Ring-buffer logger ---
var logBuf = [];
function log(msg) {
  var entry = "[" + new Date().toISOString() + "] " + msg;
  if (logBuf.length >= 200) logBuf.shift();
  logBuf.push(entry);
  process.stderr.write(entry + "\\n");
}

// --- Pi process state ---
// All mutable state lives in one object so it's easy to see what changes on restart.
var state = {
  proc: null,   // current ChildProcess
  rl: null,     // readline interface on proc.stdout
  ready: false, // true once Pi responds to the get_state probe
  active: null, // { message, res, text, t0 } — the in-flight prompt, if any
  queue: [],    // pending prompts: { message, res, text, t0 }
  gen: 0,       // incremented on every (re)start; guards against stale async callbacks
};

function startPi() {
  // Tear down the previous instance before spawning a new one.
  if (state.rl) { try { state.rl.close(); } catch (e) {} }
  if (state.proc) { try { state.proc.kill("SIGTERM"); } catch (e) {} }
  state.proc = null;
  state.rl   = null;
  state.ready  = false;
  state.active = null;
  // NB: state.queue is intentionally preserved — queued prompts are re-sent to the new Pi.

  loadEnv();
  var args = buildPiArgs();
  var gen = ++state.gen;
  log("pi start gen=" + gen + ": " + args.join(" "));

  var proc = spawn("pi", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: Object.assign({}, process.env),
  });
  state.proc = proc;

  proc.stderr.on("data", function(chunk) {
    if (state.gen === gen) log("pi stderr: " + chunk.toString().trim());
  });

  state.rl = createInterface({ input: proc.stdout });
  state.rl.on("line", function(line) {
    if (state.gen === gen) handleLine(line);
  });

  proc.on("exit", function(code) {
    if (state.gen !== gen) return;
    log("pi exit gen=" + gen + " code=" + code);
    state.proc  = null;
    state.ready = false;
    if (state.active) {
      respond(state.active.res, 500, { error: "pi exited" });
      state.active = null;
    }
  });

  // Pi needs ~500ms to initialise its RPC layer before it can handle commands.
  setTimeout(function() {
    if (state.gen !== gen || !state.proc) return;
    log("pi probe gen=" + gen);
    rpc({ id: "__probe__", type: "get_state" });
  }, 500);
}

// Write a JSON-RPC message to Pi's stdin.
function rpc(msg) {
  if (state.proc) state.proc.stdin.write(JSON.stringify(msg) + "\\n");
}

// Dispatch a single line of output from Pi's stdout.
function handleLine(line) {
  if (!line.trim()) return;
  var ev;
  try { ev = JSON.parse(line); } catch (e) { return; }

  if (!state.ready && ev.id === "__probe__" && ev.type === "response") {
    state.ready = true;
    var m = (ev.data && ev.data.model) || {};
    log("pi ready model=" + m.id + " api=" + m.api);
    flush();
    return;
  }

  var item = state.active;
  if (!item) return;

  if (ev.type === "message_update") {
    var aev = ev.assistantMessageEvent || {};
    if (aev.type === "text_delta" && aev.delta) item.text += aev.delta;
  } else if (ev.type === "agent_end") {
    log("agent_end: " + item.text.length + " chars in " + (Date.now() - item.t0) + "ms");
    respond(item.res, 200, { text: item.text, aborted: false });
    state.active = null;
    flush();
  }
}

// Send the next queued prompt to Pi, if Pi is ready and idle.
function flush() {
  if (!state.ready || state.active || !state.queue.length || !state.proc) return;
  var item = state.active = state.queue.shift();
  item.t0 = Date.now();
  rpc({ id: "p" + item.t0, type: "prompt", message: item.message });
}

// HTTP response helpers.
function respond(res, status, body) {
  try {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  } catch (e) {}
}

// --- HTTP server ---
startPi();

http.createServer(function(req, res) {
  // GET endpoints don't need a body.
  if (req.method === "GET") {
    if (req.url === "/health") { respond(res, 200, { ok: state.ready }); return; }
    if (req.url === "/logs")   { res.writeHead(200, { "Content-Type": "text/plain" }); res.end(logBuf.join("\\n")); return; }
    res.writeHead(404); res.end();
    return;
  }

  if (req.method !== "POST") { res.writeHead(405); res.end(); return; }

  var body = "";
  req.on("data", function(d) { body += d; });
  req.on("end", function() {
    var data = {};
    try { if (body) data = JSON.parse(body); } catch (e) { res.writeHead(400); res.end("bad json"); return; }

    switch (req.url) {
      case "/prompt":
        state.queue.push({ message: data.message || "", res: res, text: "", t0: 0 });
        flush();
        return;

      case "/abort":
        rpc({ id: "a" + Date.now(), type: "abort" });
        state.queue.length = 0;
        if (state.active) {
          respond(state.active.res, 200, { text: state.active.text, aborted: true });
          state.active = null;
        }
        respond(res, 200, { ok: true });
        return;

      case "/steer":
        rpc({ id: "s" + Date.now(), type: "steer", message: data.message || "" });
        respond(res, 200, { ok: true });
        return;

      case "/new-session":
        rpc({ id: "n" + Date.now(), type: "new_session" });
        respond(res, 200, { ok: true });
        return;

      case "/reload-env":
        // Merge any inline env the host sent, then restart Pi so it picks up the new env file.
        if (data.env && typeof data.env === "object") Object.assign(process.env, data.env);
        startPi();
        respond(res, 200, { ok: true });
        return;

      default:
        res.writeHead(404); res.end("not found");
    }
  });
}).listen(PORT, "0.0.0.0", function() {
  process.stderr.write("drej-bridge :" + PORT + "\\n");
});
`;

export function toShellExports(env: Record<string, string>): string {
  return (
    Object.entries(env)
      .map(([k, v]) => `export ${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
      .join("\n") + "\n"
  );
}

export function resolveEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = value.replace(
      /\$\{([^}]+)\}/g,
      (_, name: string) => process.env[name] ?? "",
    );
  }
  return result;
}

export class PiAdapter {
  private _bridgeUrl: string | null = null;

  private get bridgeUrl(): string {
    if (!this._bridgeUrl) throw new Error("PiAdapter: bridge not started");
    return this._bridgeUrl;
  }

  async setup(sb: Sandbox, spec: AgentSpec, resolvedEnv: Record<string, string>): Promise<void> {
    const pkgs = [...new Set(spec.packages ?? [])].filter(
      (p) => p !== "nodejs_22" && p !== "nodejs",
    );
    if (pkgs.length > 0) {
      await sb.exec(`apt-get update -qq && apt-get install -y --no-install-recommends ${pkgs.join(" ")}`);
    }
    await sb.exec("npm install -g --ignore-scripts @earendil-works/pi-coding-agent");

    // Write model/provider config separately from user env — bridge reads it as Pi CLI flags.
    const piConfig: Record<string, string> = {};
    if (spec.provider) piConfig.provider = spec.provider;
    if (spec.model) piConfig.model = spec.model;
    await sb.writeFile("/etc/drej-pi.json", JSON.stringify(piConfig));

    await sb.writeFile("/etc/drej-env", toShellExports(resolvedEnv));
    await sb.writeFile("/drej-bridge.js", BRIDGE_SCRIPT);
  }

  async startBridge(sb: Sandbox): Promise<void> {
    await sb.exec("node /drej-bridge.js &");
    const { url } = await sb.proxy(3001);
    this._bridgeUrl = url;
  }

  async waitReady(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.bridgeUrl}/health`);
        if (res.ok) {
          const body = (await res.json()) as { ok: boolean };
          if (body.ok) return;
        }
      } catch {
        // bridge not reachable yet
      }
      await new Promise<void>((r) => setTimeout(r, 500));
    }
    throw new Error(`drej-bridge did not become ready within ${timeoutMs / 1_000}s`);
  }

  prompt(message: string): PromptStream {
    return promptStream(this.bridgeUrl, message);
  }

  async steer(message: string): Promise<void> {
    await post(this.bridgeUrl, "/steer", { message });
  }

  async abort(): Promise<void> {
    await post(this.bridgeUrl, "/abort", {});
  }

  async newSession(): Promise<void> {
    await post(this.bridgeUrl, "/new-session", {});
  }

  async reloadEnv(env: Record<string, string>): Promise<void> {
    await post(this.bridgeUrl, "/reload-env", { env });
    await this.waitReady();
  }

  async getLogs(): Promise<string> {
    const res = await fetch(`${this.bridgeUrl}/logs`);
    return res.text();
  }
}

async function post(bridgeUrl: string, path: string, body: unknown): Promise<void> {
  await fetch(`${bridgeUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function* promptStream(bridgeUrl: string, message: string): PromptStream {
  const res = await fetch(`${bridgeUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`Bridge /prompt error: ${res.status}`);
  const body = (await res.json()) as { text?: string; aborted?: boolean };
  if (body.text) yield body.text;
}
