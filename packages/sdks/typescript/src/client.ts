export class DrejError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DrejError";
  }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface Resources {
  cpu?: string;
  memory?: string;
  gpu?: string;
}

export interface ImageAuth {
  username: string;
  password: string;
}

export interface ImageSpec {
  uri: string;
  auth?: ImageAuth;
}

export type SandboxState =
  | "Pending"
  | "Running"
  | "Pausing"
  | "Paused"
  | "Resuming"
  | "Stopping"
  | "Terminated"
  | "Failed"
  | "Unknown";

export interface SandboxStatus {
  state: SandboxState;
  reason?: string;
  message?: string;
  lastTransitionAt?: string;
}

export interface Sandbox {
  id: string;
  status: SandboxStatus;
  createdAt: string;
  expiresAt?: string | null;
  image?: ImageSpec;
  snapshotId?: string;
  entrypoint?: string[];
  metadata?: Record<string, string>;
}

export interface CreateSandboxOptions {
  image?: ImageSpec;
  snapshotId?: string;
  timeout?: number;
  resourceLimits?: Resources;
  entrypoint?: string[];
  env?: Record<string, string>;
  metadata?: Record<string, string>;
  secureAccess?: boolean;
}

export interface ListSandboxesOptions {
  state?: SandboxState;
  limit?: number;
  offset?: number;
}

export type SnapshotState = "Pending" | "Committing" | "Pushing" | "Ready" | "Failed";

export interface Snapshot {
  id: string;
  sandboxId: string;
  state: SnapshotState;
  createdAt: string;
}

export interface ListSnapshotsOptions {
  sandboxId?: string;
  limit?: number;
  offset?: number;
}

export type SSEEventType =
  | "init"
  | "status"
  | "stdout"
  | "stderr"
  | "result"
  | "execution_complete"
  | "execution_count"
  | "error"
  | "ping"
  | "message";

export interface SSEEvent {
  type: SSEEventType;
  text?: string;
  results?: Record<string, string>;
  error?: { name?: string; message: string };
  execution_count?: number;
  execution_time?: number;
  timestamp: number;
}

export interface CodeContext {
  id: string;
  language: string;
}

export interface ExecuteCodeOptions {
  code: string;
  context?: {
    id: string;
    language: string;
  };
}

export interface ExecuteCommandOptions {
  command: string;
  cwd?: string;
  background?: boolean;
  timeout?: number;
  uid?: number;
  gid?: number;
  envs?: Record<string, string>;
}

export interface CommandStatus {
  session: string;
  status: "running" | "completed" | "failed";
  exitCode?: number;
}

export interface FileInfo {
  path: string;
  size: number;
  mode: string;
  modifiedAt: string;
  isDirectory: boolean;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

export interface FileReplacement {
  path: string;
  old: string;
  new: string;
}

export interface Metrics {
  cpu: number;
  memory: number;
  timestamp: string;
}

export interface DiagnosticLog {
  name: string;
  size: number;
  url?: string;
  inline?: string;
}

export interface DiagnosticEvent {
  timestamp: string;
  type: string;
  message: string;
}

export interface DrejClientOptions {
  baseUrl?: string;
}

// ── Workflow types ─────────────────────────────────────────────────────────

export type WorkflowEventKind =
  | "step_start"
  | "step_complete"
  | "step_failed"
  | "step_rolled_back"
  | "workflow_complete"
  | "workflow_failed"
  | "checkpoint"
  | "exec_event";

export interface WorkflowEvent {
  ts: number;
  workflowId: string;
  stepIndex: number;
  branch?: number; // set on events emitted from parallel branches
  event: WorkflowEventKind;
  payload?: unknown;
  error?: string;
  result?: unknown;
}

export type Predicate =
  | { op: "eq" | "neq"; field: string; value: unknown }
  | { op: "gt" | "lt" | "gte" | "lte"; field: string; value: number }
  | { op: "exists" | "not_exists"; field: string }
  | { op: "and" | "or"; predicates: Predicate[] };

export type StepDef =
  | {
      type: "create_sandbox";
      image?: ImageSpec;
      snapshotId?: string;
      timeout?: number;
      entrypoint?: string[];
      env?: Record<string, string>;
      metadata?: Record<string, string>;
      resourceLimits?: Resources;
    }
  | { type: "exec_code"; code: string; context?: { id: string; language: string } }
  | { type: "exec_command"; command: string; cwd?: string; envs?: Record<string, string> }
  | { type: "delete_sandbox" }
  | { type: "write_file"; path: string; content: string; encoding?: "utf8" | "base64" }
  | { type: "retry"; step: StepDef; maxAttempts: number; delayMs?: number; backoff?: "fixed" | "exponential" }
  | { type: "conditional"; condition: Predicate; then: StepDef[]; else?: StepDef[] }
  | { type: "loop"; over?: string; items?: unknown[]; as: string; steps: StepDef[]; concurrently?: boolean }
  | { type: "parallel"; steps: StepDef[] };

// ── SSE parsers ────────────────────────────────────────────────────────────

async function* parseWorkflowSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<WorkflowEvent> {
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
        if (!block.trim()) continue;
        for (const line of block.split("\n")) {
          if (line.startsWith("data:")) {
            yield JSON.parse(line.slice(5).trim()) as WorkflowEvent;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

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
        if (!block.trim()) continue;
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
  } finally {
    reader.releaseLock();
  }
}

// ── Client ─────────────────────────────────────────────────────────────────

export class DrejClient {
  private baseUrl: string;

  constructor(options: DrejClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:6000").replace(/\/$/, "");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new DrejError("drej API error", res.status);
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async *streamRequest(
    method: string,
    path: string,
    body?: unknown,
  ): AsyncGenerator<SSEEvent> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new DrejError("drej API error", res.status);
    if (!res.body) return;
    yield* parseSSE(res.body);
  }

  // ── Health ───────────────────────────────────────────────────────────────

  health(): Promise<{ healthy: boolean }> {
    return this.request("GET", "/health");
  }

  // ── Sandbox lifecycle ────────────────────────────────────────────────────

  createSandbox(options: CreateSandboxOptions): Promise<Sandbox> {
    return this.request("POST", "/v1/sandboxes", options);
  }

  listSandboxes(options: ListSandboxesOptions = {}): Promise<Sandbox[]> {
    const params = new URLSearchParams();
    if (options.state) params.set("state", options.state);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    const qs = params.toString();
    return this.request("GET", `/v1/sandboxes${qs ? `?${qs}` : ""}`);
  }

  getSandbox(id: string): Promise<Sandbox> {
    return this.request("GET", `/v1/sandboxes/${id}`);
  }

  deleteSandbox(id: string): Promise<void> {
    return this.request("DELETE", `/v1/sandboxes/${id}`);
  }

  pauseSandbox(id: string): Promise<void> {
    return this.request("POST", `/v1/sandboxes/${id}/pause`);
  }

  resumeSandbox(id: string): Promise<void> {
    return this.request("POST", `/v1/sandboxes/${id}/resume`);
  }

  renewSandbox(id: string): Promise<void> {
    return this.request("POST", `/v1/sandboxes/${id}/renew`);
  }

  async waitForRunning(
    id: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<Sandbox> {
    const { timeoutMs = 60_000, pollIntervalMs = 1_000 } = options;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const sandbox = await this.getSandbox(id);
      const { state } = sandbox.status;
      if (state === "Running") return sandbox;
      if (state === "Failed" || state === "Terminated") {
        throw new DrejError(`Sandbox ${id} entered state ${state}`, 500);
      }
      await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
    }
    throw new DrejError(`Sandbox ${id} did not reach Running within ${timeoutMs}ms`, 408);
  }

  // ── Snapshots ────────────────────────────────────────────────────────────

  createSnapshot(sandboxId: string): Promise<Snapshot> {
    return this.request("POST", `/v1/sandboxes/${sandboxId}/snapshots`);
  }

  listSnapshots(options: ListSnapshotsOptions = {}): Promise<Snapshot[]> {
    const params = new URLSearchParams();
    if (options.sandboxId) params.set("sandboxId", options.sandboxId);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    const qs = params.toString();
    return this.request("GET", `/v1/snapshots${qs ? `?${qs}` : ""}`);
  }

  getSnapshot(id: string): Promise<Snapshot> {
    return this.request("GET", `/v1/snapshots/${id}`);
  }

  deleteSnapshot(id: string): Promise<void> {
    return this.request("DELETE", `/v1/snapshots/${id}`);
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────

  getDiagnosticLogs(sandboxId: string): Promise<DiagnosticLog[]> {
    return this.request("GET", `/v1/sandboxes/${sandboxId}/diagnostics/logs`);
  }

  getDiagnosticEvents(sandboxId: string): Promise<DiagnosticEvent[]> {
    return this.request("GET", `/v1/sandboxes/${sandboxId}/diagnostics/events`);
  }

  // ── Code execution ───────────────────────────────────────────────────────

  async *executeCode(sandboxId: string, options: ExecuteCodeOptions): AsyncGenerator<SSEEvent> {
    yield* this.streamRequest("POST", `/v1/sandboxes/${sandboxId}/exec/code`, options);
  }

  interruptCode(sandboxId: string): Promise<void> {
    return this.request("DELETE", `/v1/sandboxes/${sandboxId}/exec/code`);
  }

  // ── Code contexts ────────────────────────────────────────────────────────

  listContexts(sandboxId: string, language?: string): Promise<CodeContext[]> {
    const qs = language ? `?language=${encodeURIComponent(language)}` : "";
    return this.request("GET", `/v1/sandboxes/${sandboxId}/exec/contexts${qs}`);
  }

  createContext(sandboxId: string, language: string): Promise<CodeContext> {
    return this.request("POST", `/v1/sandboxes/${sandboxId}/exec/contexts`, { language });
  }

  clearContexts(sandboxId: string, language?: string): Promise<void> {
    const qs = language ? `?language=${encodeURIComponent(language)}` : "";
    return this.request("DELETE", `/v1/sandboxes/${sandboxId}/exec/contexts${qs}`);
  }

  deleteContext(sandboxId: string, contextId: string): Promise<void> {
    return this.request("DELETE", `/v1/sandboxes/${sandboxId}/exec/contexts/${contextId}`);
  }

  // ── Command execution ────────────────────────────────────────────────────

  async *executeCommand(
    sandboxId: string,
    options: ExecuteCommandOptions,
  ): AsyncGenerator<SSEEvent> {
    yield* this.streamRequest("POST", `/v1/sandboxes/${sandboxId}/exec/command`, options);
  }

  interruptCommand(sandboxId: string): Promise<void> {
    return this.request("DELETE", `/v1/sandboxes/${sandboxId}/exec/command`);
  }

  getCommandStatus(sandboxId: string, session: string): Promise<CommandStatus> {
    return this.request("GET", `/v1/sandboxes/${sandboxId}/exec/command/status/${session}`);
  }

  getCommandOutput(
    sandboxId: string,
    session: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return this.request("GET", `/v1/sandboxes/${sandboxId}/exec/command/output/${session}`);
  }

  // ── Files ────────────────────────────────────────────────────────────────

  getFileInfo(sandboxId: string, path: string): Promise<FileInfo> {
    return this.request(
      "GET",
      `/v1/sandboxes/${sandboxId}/files/info?path=${encodeURIComponent(path)}`,
    );
  }

  deleteFile(sandboxId: string, path: string): Promise<void> {
    return this.request(
      "DELETE",
      `/v1/sandboxes/${sandboxId}/files?path=${encodeURIComponent(path)}`,
    );
  }

  setFilePermissions(sandboxId: string, path: string, mode: string): Promise<void> {
    return this.request("POST", `/v1/sandboxes/${sandboxId}/files/permissions`, { path, mode });
  }

  moveFile(sandboxId: string, from: string, to: string): Promise<void> {
    return this.request("POST", `/v1/sandboxes/${sandboxId}/files/move`, { from, to });
  }

  searchFiles(sandboxId: string, pattern: string, dir?: string): Promise<string[]> {
    const params = new URLSearchParams({ pattern });
    if (dir) params.set("dir", dir);
    return this.request("GET", `/v1/sandboxes/${sandboxId}/files/search?${params}`);
  }

  replaceInFiles(sandboxId: string, replacements: FileReplacement[]): Promise<void> {
    return this.request("POST", `/v1/sandboxes/${sandboxId}/files/replace`, { replacements });
  }

  async uploadFile(
    sandboxId: string,
    path: string,
    content: Blob | BufferSource | string,
  ): Promise<void> {
    const blob = content instanceof Blob ? content : new Blob([content]);
    const formData = new FormData();
    formData.append("file", blob, path.split("/").pop());
    formData.append("path", path);
    const res = await fetch(`${this.baseUrl}/v1/sandboxes/${sandboxId}/files/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new DrejError("drej API error", res.status);
  }

  async downloadFile(sandboxId: string, path: string): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(
      `${this.baseUrl}/v1/sandboxes/${sandboxId}/files/download?path=${encodeURIComponent(path)}`,
    );
    if (!res.ok) throw new DrejError("drej API error", res.status);
    if (!res.body) throw new Error("empty response body");
    return res.body;
  }

  // ── Directories ──────────────────────────────────────────────────────────

  listDirectory(sandboxId: string, path: string, depth?: number): Promise<DirectoryEntry[]> {
    const params = new URLSearchParams({ path });
    if (depth !== undefined) params.set("depth", String(depth));
    return this.request("GET", `/v1/sandboxes/${sandboxId}/directories?${params}`);
  }

  createDirectory(sandboxId: string, path: string): Promise<void> {
    return this.request("POST", `/v1/sandboxes/${sandboxId}/directories`, { path });
  }

  deleteDirectory(sandboxId: string, path: string): Promise<void> {
    return this.request(
      "DELETE",
      `/v1/sandboxes/${sandboxId}/directories?path=${encodeURIComponent(path)}`,
    );
  }

  // ── Metrics ──────────────────────────────────────────────────────────────

  getMetrics(sandboxId: string): Promise<Metrics> {
    return this.request("GET", `/v1/sandboxes/${sandboxId}/metrics`);
  }

  async *watchMetrics(sandboxId: string): AsyncGenerator<SSEEvent> {
    yield* this.streamRequest("GET", `/v1/sandboxes/${sandboxId}/metrics/watch`);
  }

  // ── Workflows ────────────────────────────────────────────────────────────

  async *runWorkflow(id: string, steps: StepDef[]): AsyncGenerator<WorkflowEvent> {
    const res = await fetch(`${this.baseUrl}/v1/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, steps }),
    });
    if (!res.ok) throw new DrejError("drej API error", res.status);
    if (!res.body) return;
    yield* parseWorkflowSSE(res.body);
  }

  async *resumeWorkflow(id: string, steps: StepDef[]): AsyncGenerator<WorkflowEvent> {
    const res = await fetch(`${this.baseUrl}/v1/workflows/${id}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps }),
    });
    if (!res.ok) throw new DrejError("drej API error", res.status);
    if (!res.body) return;
    yield* parseWorkflowSSE(res.body);
  }

  getWorkflowLedger(id: string): Promise<WorkflowEvent[]> {
    return this.request("GET", `/v1/workflows/${id}/ledger`);
  }
}
