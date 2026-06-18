import type {
  SSEEvent,
  SSEEventType,
  CodeContext,
  ExecuteCodeOptions,
  ExecuteCommandOptions,
  CommandStatus,
  FileInfo,
  FileReplacement,
  DirectoryEntry,
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
            yield { type: (type ?? "message") as SSEEventType, ...JSON.parse(data) };
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

  constructor(options: { baseUrl?: string; accessToken: string }) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:44772").replace(/\/$/, "");
    this.accessToken = options.accessToken;
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

  getFileInfo(path: string): Promise<FileInfo> {
    return this.request("GET", `/files/info?path=${encodeURIComponent(path)}`);
  }

  deleteFile(path: string): Promise<void> {
    return this.request("DELETE", `/files?path=${encodeURIComponent(path)}`);
  }

  setPermissions(path: string, mode: string): Promise<void> {
    return this.request("POST", "/files/permissions", { path, mode });
  }

  moveFile(from: string, to: string): Promise<void> {
    return this.request("POST", "/files/mv", { from, to });
  }

  searchFiles(pattern: string, dir?: string): Promise<string[]> {
    const params = new URLSearchParams({ pattern });
    if (dir) params.set("dir", dir);
    return this.request("GET", `/files/search?${params}`);
  }

  replaceInFiles(replacements: FileReplacement[]): Promise<void> {
    return this.request("POST", "/files/replace", { replacements });
  }

  async uploadFile(path: string, content: Blob | BufferSource | string): Promise<void> {
    const blob = content instanceof Blob ? content : new Blob([content]);
    const formData = new FormData();
    formData.append("file", blob, path.split("/").pop());
    formData.append("path", path);
    const res = await fetch(`${this.baseUrl}/files/upload`, {
      method: "POST",
      headers: this.authHeader,
      body: formData,
    });
    if (!res.ok) throw new Error(`execd error ${res.status}`);
  }

  async downloadFile(path: string): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(`${this.baseUrl}/files/download?path=${encodeURIComponent(path)}`, {
      headers: this.authHeader,
    });
    if (!res.ok) throw new Error(`execd error ${res.status}`);
    if (!res.body) throw new Error("empty response body");
    return res.body;
  }

  listDirectory(path: string, depth?: number): Promise<DirectoryEntry[]> {
    const params = new URLSearchParams({ path });
    if (depth !== undefined) params.set("depth", String(depth));
    return this.request("GET", `/directories/list?${params}`);
  }

  createDirectory(path: string): Promise<void> {
    return this.request("POST", "/directories", { path });
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
