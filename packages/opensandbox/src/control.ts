import { SnapshotState } from "./types";
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

// OpenSandbox returns snapshot state nested under status: { state }.
// We flatten it at the client boundary so callers always get a flat Snapshot.
interface RawSnapshot {
  id: string;
  sandboxId: string;
  status: { state: SnapshotState };
  createdAt: string;
}

function flattenSnapshot(raw: RawSnapshot): Snapshot {
  return { id: raw.id, sandboxId: raw.sandboxId, state: raw.status.state, createdAt: raw.createdAt };
}

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
  private signal?: AbortSignal;

  constructor(options: { baseUrl: string; apiKey: string; signal?: AbortSignal }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.signal = options.signal;
  }

  withSignal(signal: AbortSignal): ControlClient {
    return new ControlClient({ baseUrl: this.baseUrl, apiKey: this.apiKey, signal });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "OPEN-SANDBOX-API-KEY": this.apiKey,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: this.signal,
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

  async createSnapshot(sandboxId: string): Promise<Snapshot> {
    const raw = await this.request<RawSnapshot>("POST", `/v1/sandboxes/${sandboxId}/snapshots`);
    return flattenSnapshot(raw);
  }

  listSnapshots(options: ListSnapshotsOptions = {}): Promise<Snapshot[]> {
    const params = new URLSearchParams();
    if (options.sandboxId) params.set("sandboxId", options.sandboxId);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    const qs = params.toString();
    return this.request("GET", `/v1/snapshots${qs ? `?${qs}` : ""}`);
  }

  async getSnapshot(id: string): Promise<Snapshot> {
    const raw = await this.request<RawSnapshot>("GET", `/v1/snapshots/${id}`);
    return flattenSnapshot(raw);
  }

  deleteSnapshot(id: string): Promise<void> {
    return this.request("DELETE", `/v1/snapshots/${id}`);
  }
}
