import { SSEEventType } from "./types";
import type {
  SSEEvent,
  CodeContext,
  ExecuteCodeOptions,
  ExecuteCommandOptions,
  CommandStatus,
  FileInfo,
  FileReplacement,
  Metrics,
} from "./types";

async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("{")) {
          // execd sends raw JSON lines, not data:-prefixed SSE
          try { yield JSON.parse(trimmed) as SSEEvent; } catch { /* skip malformed */ }
        } else {
          let type: string | undefined;
          let data: string | undefined;
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) data = line.slice(5).trim();
          }
          if (data !== undefined) {
            yield { type: (type ?? SSEEventType.Message) as SSEEventType, ...JSON.parse(data) };
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class ExecClient {
  private baseUrl: string;
  private accessToken: string;
  private signal?: AbortSignal;

  constructor(options: { baseUrl?: string; accessToken: string; signal?: AbortSignal }) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:44772").replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.signal = options.signal;
  }

  /** Return a new `ExecClient` instance that passes `signal` to every fetch call. */
  withSignal(signal: AbortSignal): ExecClient {
    return new ExecClient({ baseUrl: this.baseUrl, accessToken: this.accessToken, signal });
  }

  private get authHeader(): Record<string, string> {
    return { "X-EXECD-ACCESS-TOKEN": this.accessToken };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...this.authHeader,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: this.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `execd error ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async *streamRequest(method: string, path: string, body?: unknown): AsyncGenerator<SSEEvent> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...this.authHeader,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: this.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `execd error ${res.status}`);
    }
    if (!res.body) return;
    yield* parseSSE(res.body);
  }

  ping(): Promise<{ status: string }> {
    return this.request("GET", "/ping");
  }

  listContexts(language?: string): Promise<CodeContext[]> {
    const qs = language ? `?language=${encodeURIComponent(language)}` : "";
    return this.request("GET", `/code/contexts${qs}`);
  }

  clearContexts(language?: string): Promise<void> {
    const qs = language ? `?language=${encodeURIComponent(language)}` : "";
    return this.request("DELETE", `/code/contexts${qs}`);
  }

  deleteContext(contextId: string): Promise<void> {
    return this.request("DELETE", `/code/contexts/${contextId}`);
  }

  createContext(language: string): Promise<CodeContext> {
    return this.request("POST", "/code/context", { language });
  }

  async *executeCode(options: ExecuteCodeOptions): AsyncGenerator<SSEEvent> {
    yield* this.streamRequest("POST", "/code", options);
  }

  interruptCode(): Promise<void> {
    return this.request("DELETE", "/code");
  }

  async *executeCommand(options: ExecuteCommandOptions): AsyncGenerator<SSEEvent> {
    yield* this.streamRequest("POST", "/command", options);
  }

  interruptCommand(): Promise<void> {
    return this.request("DELETE", "/command");
  }

  getCommandStatus(session: string): Promise<CommandStatus> {
    return this.request("GET", `/command/status/${session}`);
  }

  getCommandOutput(session: string): Promise<{ stdout: string; stderr: string }> {
    return this.request("GET", `/command/output/${session}`);
  }

  async getFileInfo(path: string): Promise<FileInfo> {
    const map = await this.request<Record<string, FileInfo>>("GET", `/files/info?path=${encodeURIComponent(path)}`);
    const entry = map[path];
    if (!entry) throw new Error(`getFileInfo: no entry for path ${path}`);
    return entry;
  }

  deleteFile(path: string): Promise<void> {
    return this.request("DELETE", `/files?path=${encodeURIComponent(path)}`);
  }

  setPermissions(path: string, mode: string): Promise<void> {
    return this.request("POST", "/files/permissions", { [path]: { mode: parseInt(mode, 10) } });
  }

  moveFile(from: string, to: string): Promise<void> {
    return this.request("POST", "/files/mv", [{ src: from, dest: to }]);
  }

  async searchFiles(pattern: string, path: string = "/"): Promise<string[]> {
    const params = new URLSearchParams({ path, pattern });
    const entries = await this.request<FileInfo[]>("GET", `/files/search?${params}`);
    return entries.map((e) => e.path);
  }

  replaceInFiles(replacements: FileReplacement[]): Promise<void> {
    const body: Record<string, { old: string; new: string }> = {};
    for (const r of replacements) body[r.path] = { old: r.old, new: r.new };
    return this.request("POST", "/files/replace", body);
  }

  async uploadFile(path: string, content: Blob | BufferSource | string): Promise<void> {
    // execd requires File objects (not Blob) so Content-Disposition includes a filename attribute.
    const formData = new FormData();
    formData.append("metadata", new File([JSON.stringify({ path })], "metadata.json", { type: "application/json" }));
    formData.append("file", new File([content], path.split("/").pop() ?? "file", { type: "application/octet-stream" }));
    const res = await fetch(`${this.baseUrl}/files/upload`, {
      method: "POST",
      headers: this.authHeader,
      body: formData,
      signal: this.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `execd error ${res.status}`);
    }
  }

  async downloadFile(path: string): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(`${this.baseUrl}/files/download?path=${encodeURIComponent(path)}`, {
      headers: this.authHeader,
      signal: this.signal,
    });
    if (!res.ok) throw new Error(`execd error ${res.status}`);
    if (!res.body) throw new Error("empty response body");
    return res.body;
  }

  listDirectory(path: string, depth?: number): Promise<FileInfo[]> {
    const params = new URLSearchParams({ path });
    if (depth !== undefined) params.set("depth", String(depth));
    return this.request("GET", `/directories/list?${params}`);
  }

  createDirectory(path: string): Promise<void> {
    return this.request("POST", "/directories", { [path]: { mode: 755 } });
  }

  deleteDirectory(path: string): Promise<void> {
    return this.request("DELETE", `/directories?path=${encodeURIComponent(path)}`);
  }

  getMetrics(): Promise<Metrics> {
    return this.request("GET", "/metrics");
  }

  async *watchMetrics(): AsyncGenerator<SSEEvent> {
    yield* this.streamRequest("GET", "/metrics/watch");
  }
}
