import type {
  ISandboxControl,
  IExecClientFactory,
  ISandboxExec,
  Sandbox,
  CreateSandboxInput,
  SandboxState,
  SnapshotInfo,
  SnapshotState,
} from "@drej/core";
import { ControlClient } from "./control";
import { ExecClient } from "./exec";

// The OpenSandbox API returns snapshot state nested under status: { state }.
// SnapshotInfo (our core port type) flattens it to state at the top level.
interface RawSnapshot {
  id: string;
  sandboxId: string;
  status: { state: SnapshotState };
  createdAt: string;
}

function toSnapshotInfo(raw: RawSnapshot): SnapshotInfo {
  return { id: raw.id, sandboxId: raw.sandboxId, state: raw.status.state, createdAt: raw.createdAt };
}

// Implements the @drej/core ISandboxControl port using OpenSandbox's ControlClient.
// Types are structurally compatible; the return type cast on createSandbox resolves
// the nominal mismatch between @drej/core.Sandbox and @drej/opensandbox.Sandbox.
export class OpenSandboxControlAdapter implements ISandboxControl {
  constructor(readonly client: ControlClient) {}

  createSandbox(options: CreateSandboxInput): Promise<Sandbox> {
    return this.client.createSandbox(options) as Promise<Sandbox>;
  }

  getSandbox(id: string): Promise<Sandbox> {
    return this.client.getSandbox(id) as Promise<Sandbox>;
  }

  listSandboxes(options?: { state?: SandboxState; limit?: number; offset?: number }): Promise<Sandbox[]> {
    return this.client.listSandboxes(options) as Promise<Sandbox[]>;
  }

  deleteSandbox(id: string): Promise<void> {
    return this.client.deleteSandbox(id);
  }

  pauseSandbox(id: string): Promise<void> {
    return this.client.pauseSandbox(id);
  }

  resumeSandbox(id: string): Promise<void> {
    return this.client.resumeSandbox(id);
  }

  renewExpiration(id: string): Promise<void> {
    return this.client.renewExpiration(id);
  }

  // OpenSandbox returns { status: { state } } but SnapshotInfo flattens it to { state }.
  async createSnapshot(sandboxId: string): Promise<SnapshotInfo> {
    const raw = await this.client.createSnapshot(sandboxId) as unknown as RawSnapshot;
    return toSnapshotInfo(raw);
  }

  async getSnapshot(id: string): Promise<SnapshotInfo> {
    const raw = await this.client.getSnapshot(id) as unknown as RawSnapshot;
    return toSnapshotInfo(raw);
  }
}

// Implements the @drej/core IExecClientFactory port.
// Encapsulates the execd readiness polling logic (getEndpoint → poll listContexts)
// that was previously inlined in apps/api/src/index.ts.
export class OpenSandboxExecFactory implements IExecClientFactory {
  constructor(
    private readonly control: ControlClient,
    private readonly retries = 15,
    private readonly delayMs = 1_000,
  ) {}

  async forSandbox(sandboxId: string): Promise<ISandboxExec> {
    const ep = await this.control.getEndpoint(sandboxId, 44772);
    const baseUrl = ep.endpoint.startsWith("http") ? ep.endpoint : `http://${ep.endpoint}`;
    const token = ep.headers?.["X-EXECD-ACCESS-TOKEN"] ?? "";
    const client = new ExecClient({ baseUrl, accessToken: token });

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        await client.listContexts();
        return client as unknown as ISandboxExec;
      } catch {
        if (attempt === this.retries) {
          throw new Error(`execd not ready after ${this.retries}s for sandbox ${sandboxId}`);
        }
        await new Promise<void>((r) => setTimeout(r, this.delayMs));
      }
    }
    throw new Error("unreachable");
  }
}
