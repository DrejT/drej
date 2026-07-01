import type { Sandbox } from "@drej/core";
import type { AgentSpec } from "../schema";
import type { CompactResult, PiMessage, PiModel, PromptStream, ThinkingLevel } from "../types";

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
// Supports: provider, model, resume (--continue to resume the most recent session).
function buildPiArgs() {
  var args = ["--mode", "rpc", "--approve"];
  try {
    if (fs.existsSync(PI_CONFIG_FILE)) {
      var cfg = JSON.parse(fs.readFileSync(PI_CONFIG_FILE, "utf8"));
      if (cfg.provider) args.push("--provider", cfg.provider);
      if (cfg.model) args.push("--model", cfg.model);
      if (cfg.resume) args.push("--continue");
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
  proc: null,        // current ChildProcess
  rl: null,          // readline interface on proc.stdout
  ready: false,      // true once Pi responds to the get_state probe
  active: null,      // { message, res, text, t0 } — the in-flight prompt, if any
  queue: [],         // pending items: { message, streamingBehavior?, res, text, t0 }
  gen: 0,            // incremented on every (re)start; guards against stale async callbacks
  pendingCmds: {},   // id → { res, timer, bash? } — commands waiting for Pi's response ack
};

// Fail all in-flight pendingCmds cleanly, handling bash (SSE) vs regular (JSON) responses.
function cleanupPendingCmds(reason) {
  Object.keys(state.pendingCmds).forEach(function(id) {
    var p = state.pendingCmds[id];
    clearTimeout(p.timer);
    if (p.bash) {
      try { p.res.write("data: " + JSON.stringify({ error: reason }) + "\\n\\n"); p.res.end(); } catch (e) {}
    } else {
      respond(p.res, 500, { ok: false, error: reason });
    }
  });
  state.pendingCmds = {};
}

function startPi() {
  // End any in-flight SSE stream so the client isn't left hanging.
  if (state.active) {
    state.active.res.write("data: " + JSON.stringify({ error: "pi restarted" }) + "\\n\\n");
    state.active.res.end();
    state.active = null;
  }
  cleanupPendingCmds("pi restarted");

  if (state.rl) { try { state.rl.close(); } catch (e) {} }
  if (state.proc) { try { state.proc.kill("SIGTERM"); } catch (e) {} }
  state.proc = null;
  state.rl   = null;
  state.ready  = false;
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
    cleanupPendingCmds("pi exited");
    if (state.active) {
      state.active.res.write("data: " + JSON.stringify({ error: "pi exited" }) + "\\n\\n");
      state.active.res.end();
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

// Send an RPC command and hold the HTTP response open until Pi acks it.
function rpcWithAck(msg, res) {
  state.pendingCmds[msg.id] = { res: res };
  rpc(msg);
  state.pendingCmds[msg.id].timer = setTimeout(function() {
    if (state.pendingCmds[msg.id]) {
      respond(state.pendingCmds[msg.id].res, 504, { error: "timeout" });
      delete state.pendingCmds[msg.id];
    }
  }, 5000);
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

  // Resolve a pending command ack.
  // Bash returns output synchronously in ev.data — stream it as SSE then send [DONE].
  // All other commands use JSON response.
  if (ev.type === "response" && ev.id && state.pendingCmds[ev.id]) {
    var pending = state.pendingCmds[ev.id];
    clearTimeout(pending.timer);
    delete state.pendingCmds[ev.id];
    if (pending.bash) {
      var output = (ev.data && ev.data.output) || "";
      if (output) try { pending.res.write("data: " + JSON.stringify({ text: output }) + "\\n\\n"); } catch (e) {}
      try { pending.res.write("data: [DONE]\\n\\n"); pending.res.end(); } catch (e) {}
    } else if (ev.success) {
      respond(pending.res, 200, { ok: true, data: ev.data || null });
    } else {
      respond(pending.res, 400, { ok: false, error: ev.error || "unknown" });
    }
    return;
  }

  var item = state.active;
  if (!item) return;

  // prompt: forward text_delta chunks
  if (ev.type === "message_update") {
    var aev = ev.assistantMessageEvent || {};
    if (aev.type === "text_delta" && aev.delta) {
      item.text += aev.delta;
      item.res.write("data: " + JSON.stringify({ text: aev.delta }) + "\\n\\n");
    }
  } else if (ev.type === "agent_end") {
    log("agent_end: " + item.text.length + " chars in " + (Date.now() - item.t0) + "ms");
    item.res.write("data: [DONE]\\n\\n");
    item.res.end();
    state.active = null;
    flush();
  }
}

// Send the next queued item to Pi, if Pi is ready and idle.
// streamingBehavior items ("steer"/"followUp") bypass the active-slot gate and complete immediately.
function flush() {
  if (!state.ready || !state.queue.length || !state.proc) return;
  var item = state.queue[0];
  if (state.active && !item.streamingBehavior) return;
  state.queue.shift();
  if (!item.streamingBehavior) state.active = item;
  item.t0 = Date.now();
  var rpcMsg = { id: "p" + item.t0, type: "prompt", message: item.message };
  if (item.streamingBehavior) rpcMsg.streamingBehavior = item.streamingBehavior;
  rpc(rpcMsg);
  item.res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  // Injections don't produce their own SSE body — their output arrives via the active prompt's stream.
  if (item.streamingBehavior) {
    item.res.write("data: [DONE]\\n\\n");
    item.res.end();
    flush();
  }
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
    if (req.url === "/messages") { rpcWithAck({ id: "gm" + Date.now(), type: "get_messages" }, res); return; }
    if (req.url === "/available-models") { rpcWithAck({ id: "gam" + Date.now(), type: "get_available_models" }, res); return; }
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
        state.queue.push({ message: data.message || "", streamingBehavior: data.streamingBehavior, res: res, text: "", t0: 0 });
        flush();
        return;

      case "/bash": {
        // Pi returns bash output synchronously in the ack's data.output — no streaming events.
        if (!state.ready || !state.proc) { respond(res, 503, { error: "pi not ready" }); return; }
        var bashId = "b" + Date.now();
        var bashTimer = setTimeout(function() {
          if (state.pendingCmds[bashId]) {
            delete state.pendingCmds[bashId];
            try { res.write("data: " + JSON.stringify({ error: "bash timeout" }) + "\\n\\n"); res.end(); } catch (e) {}
          }
        }, 30000);
        state.pendingCmds[bashId] = { res: res, timer: bashTimer, bash: true };
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
        rpc({ id: bashId, type: "bash", command: data.command || "" });
        return;
      }

      case "/abort":
        // End the active SSE stream immediately, drain the queue, then wait for Pi's ack.
        state.queue.length = 0;
        if (state.active) {
          state.active.res.write("data: [DONE]\\n\\n");
          state.active.res.end();
          state.active = null;
        }
        rpcWithAck({ id: "a" + Date.now(), type: "abort" }, res);
        return;

      case "/steer":
        rpcWithAck({ id: "s" + Date.now(), type: "steer", message: data.message || "" }, res);
        return;

      case "/follow-up":
        rpcWithAck({ id: "fu" + Date.now(), type: "follow_up", message: data.message || "" }, res);
        return;

      case "/new-session":
        rpcWithAck({ id: "n" + Date.now(), type: "new_session" }, res);
        return;

      case "/fork":
        rpcWithAck({ id: "fk" + Date.now(), type: "fork", entryId: data.entryId || "" }, res);
        return;

      case "/clone":
        rpcWithAck({ id: "cl" + Date.now(), type: "clone" }, res);
        return;

      case "/switch-session":
        rpcWithAck({ id: "ss" + Date.now(), type: "switch_session", sessionPath: data.sessionPath || "" }, res);
        return;

      case "/set-model":
        rpcWithAck({ id: "sm" + Date.now(), type: "set_model", provider: data.provider || "", modelId: data.modelId || "" }, res);
        return;

      case "/cycle-model":
        rpcWithAck({ id: "cm" + Date.now(), type: "cycle_model" }, res);
        return;

      case "/set-thinking-level":
        rpcWithAck({ id: "stl" + Date.now(), type: "set_thinking_level", level: data.level || "medium" }, res);
        return;

      case "/cycle-thinking-level":
        rpcWithAck({ id: "ctl" + Date.now(), type: "cycle_thinking_level" }, res);
        return;

      case "/compact": {
        var compactMsg = { id: "co" + Date.now(), type: "compact" };
        if (data.customInstructions) compactMsg.customInstructions = data.customInstructions;
        rpcWithAck(compactMsg, res);
        return;
      }

      case "/set-auto-compaction":
        rpcWithAck({ id: "sac" + Date.now(), type: "set_auto_compaction", enabled: !!data.enabled }, res);
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
    result[key] = value.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? "");
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
      await sb.exec(
        `apt-get update -qq && apt-get install -y --no-install-recommends ${pkgs.join(" ")}`,
      );
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

  // --- streaming ---

  prompt(message: string, opts?: { streamingBehavior?: "steer" | "followUp" }): PromptStream {
    return sseStream(this.bridgeUrl, "/prompt", {
      message,
      streamingBehavior: opts?.streamingBehavior,
    });
  }

  bash(command: string): PromptStream {
    return sseStream(this.bridgeUrl, "/bash", { command });
  }

  // --- ack-only commands ---

  async steer(message: string): Promise<void> {
    const res = await fetch(`${this.bridgeUrl}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(`steer failed: ${body.error ?? res.status}`);
    }
  }

  async abort(): Promise<void> {
    await rpcPost(this.bridgeUrl, "/abort");
  }

  async followUp(message: string): Promise<void> {
    await rpcPost(this.bridgeUrl, "/follow-up", { message });
  }

  async newSession(): Promise<void> {
    await rpcPost(this.bridgeUrl, "/new-session");
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    await rpcPost(this.bridgeUrl, "/set-thinking-level", { level });
  }

  async setAutoCompaction(enabled: boolean): Promise<void> {
    await rpcPost(this.bridgeUrl, "/set-auto-compaction", { enabled });
  }

  // --- commands that return data ---

  async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
    return rpcPost(this.bridgeUrl, "/fork", { entryId });
  }

  async clone(): Promise<{ cancelled: boolean }> {
    return rpcPost(this.bridgeUrl, "/clone");
  }

  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    return rpcPost(this.bridgeUrl, "/switch-session", { sessionPath });
  }

  async setModel(provider: string, modelId: string): Promise<PiModel> {
    return rpcPost<PiModel>(this.bridgeUrl, "/set-model", { provider, modelId });
  }

  async cycleModel(): Promise<{
    model: PiModel;
    thinkingLevel: ThinkingLevel;
    isScoped: boolean;
  } | null> {
    return rpcPost(this.bridgeUrl, "/cycle-model");
  }

  async cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null> {
    return rpcPost(this.bridgeUrl, "/cycle-thinking-level");
  }

  async compact(customInstructions?: string): Promise<CompactResult> {
    return rpcPost<CompactResult>(this.bridgeUrl, "/compact", { customInstructions });
  }

  async getMessages(): Promise<PiMessage[]> {
    const data = await rpcGet<{ messages: PiMessage[] }>(this.bridgeUrl, "/messages");
    return data.messages;
  }

  async getAvailableModels(): Promise<PiModel[]> {
    const data = await rpcGet<{ models: PiModel[] }>(this.bridgeUrl, "/available-models");
    return data.models;
  }

  // --- misc ---

  async reloadEnv(env: Record<string, string>): Promise<void> {
    await rpcPost(this.bridgeUrl, "/reload-env", { env });
    await this.waitReady();
  }

  async getLogs(): Promise<string> {
    const res = await fetch(`${this.bridgeUrl}/logs`);
    return res.text();
  }
}

// --- HTTP helpers ---

async function rpcPost<T = null>(bridgeUrl: string, path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`${path} failed: ${err.error ?? res.status}`);
  }
  const payload = (await res.json()) as { ok: boolean; data?: T };
  return payload.data as T;
}

async function rpcGet<T>(bridgeUrl: string, path: string): Promise<T> {
  const res = await fetch(`${bridgeUrl}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  const payload = (await res.json()) as { ok: boolean; data?: T };
  return payload.data as T;
}

async function* sseStream(bridgeUrl: string, path: string, body: unknown): PromptStream {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`Bridge ${path} error: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return;
      const ev = JSON.parse(payload) as { text?: string; error?: string };
      if (ev.error) throw new Error(`Bridge error: ${ev.error}`);
      if (ev.text) yield ev.text;
    }
  }
}
