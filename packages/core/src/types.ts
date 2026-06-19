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
  metadata?: Record<string, string>;
}

export interface SSEEvent {
  type: string;
  text?: string;
  timestamp: number;
  error?: { name?: string; message: string };
  [key: string]: unknown;
}

export interface CreateSandboxInput {
  image?: { uri: string; auth?: { username: string; password: string } };
  snapshotId?: string;
  timeout?: number;
  entrypoint?: string[];
  env?: Record<string, string>;
  metadata?: Record<string, string>;
  resourceLimits?: { cpu?: string; memory?: string; gpu?: string };
}

export interface ExecuteCodeInput {
  code: string;
  context?: { id: string; language: string };
}

export interface ExecuteCommandInput {
  command: string;
  cwd?: string;
  background?: boolean;
  timeout?: number;
  uid?: number;
  gid?: number;
  envs?: Record<string, string>;
}

export type SnapshotState = "Pending" | "Committing" | "Pushing" | "Ready" | "Failed";

export interface SnapshotInfo {
  id: string;
  sandboxId: string;
  state: SnapshotState;
  createdAt: string;
}

// Ports — implemented by adapters in apps/api, never imported by SDKs

export interface ISandboxControl {
  createSandbox(options: CreateSandboxInput): Promise<Sandbox>;
  getSandbox(id: string): Promise<Sandbox>;
  listSandboxes(options?: { state?: SandboxState; limit?: number; offset?: number }): Promise<Sandbox[]>;
  deleteSandbox(id: string): Promise<void>;
  pauseSandbox(id: string): Promise<void>;
  resumeSandbox(id: string): Promise<void>;
  renewExpiration(id: string): Promise<void>;
  createSnapshot(sandboxId: string): Promise<SnapshotInfo>;
  getSnapshot(id: string): Promise<SnapshotInfo>;
}

export interface ISandboxExec {
  executeCode(options: ExecuteCodeInput): AsyncGenerator<SSEEvent>;
  executeCommand(options: ExecuteCommandInput): AsyncGenerator<SSEEvent>;
  uploadFile(path: string, content: string | Uint8Array): Promise<void>;
}

export interface IExecClientFactory {
  forSandbox(sandboxId: string): Promise<ISandboxExec>;
}
