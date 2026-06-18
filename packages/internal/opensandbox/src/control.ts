import type {
  Sandbox,
  CreateSandboxOptions,
  ListSandboxesOptions,
  Snapshot,
  ListSnapshotsOptions,
  SandboxEndpoint,
  DiagnosticLog,
  DiagnosticEvent,
} from "./types";

export class OpenSandboxError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "OpenSandboxError";
  }
}

export class ControlClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(options: { baseUrl: string; apiKey: string }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "OPEN-SANDBOX-API-KEY": this.apiKey,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new OpenSandboxError(text || "OpenSandbox API error", res.status);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

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

  renewExpiration(id: string): Promise<void> {
    return this.request("POST", `/v1/sandboxes/${id}/renew-expiration`);
  }

  // Returns { endpoint, headers: { "X-EXECD-ACCESS-TOKEN": "..." } }
  getEndpoint(sandboxId: string, port: number): Promise<SandboxEndpoint> {
    return this.request("GET", `/v1/sandboxes/${sandboxId}/endpoints/${port}`);
  }

  getDiagnosticLogs(sandboxId: string): Promise<DiagnosticLog[]> {
    return this.request("GET", `/v1/sandboxes/${sandboxId}/diagnostics/logs`);
  }

  getDiagnosticEvents(sandboxId: string): Promise<DiagnosticEvent[]> {
    return this.request("GET", `/v1/sandboxes/${sandboxId}/diagnostics/events`);
  }

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
}
