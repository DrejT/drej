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

export enum SandboxState {
  Pending = "Pending",
  Running = "Running",
  Pausing = "Pausing",
  Paused = "Paused",
  Resuming = "Resuming",
  Stopping = "Stopping",
  Terminated = "Terminated",
  Failed = "Failed",
  Unknown = "Unknown",
}

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
  platform?: unknown;
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

export enum SnapshotState {
  Pending = "Pending",
  Committing = "Committing",
  Pushing = "Pushing",
  Ready = "Ready",
  Failed = "Failed",
}

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

// GET /v1/sandboxes/:id/endpoints/:port response
export interface SandboxEndpoint {
  endpoint: string;
  headers?: Record<string, string>;
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

export enum SSEEventType {
  Init = "init",
  Status = "status",
  Stdout = "stdout",
  Stderr = "stderr",
  Result = "result",
  ExecutionComplete = "execution_complete",
  ExecutionCount = "execution_count",
  Error = "error",
  Ping = "ping",
  Message = "message",
}

export interface SSEEvent {
  type: SSEEventType;
  text?: string;
  results?: Record<string, string>;
  error?: { name?: string; message: string; evalue?: string };
  execution_count?: number;
  execution_time?: number;
  timestamp: number;
}

export enum CodeLanguage {
  Python = "python",
  JavaScript = "javascript",
  TypeScript = "typescript",
  Go = "go",
  Java = "java",
  Bash = "bash",
}

export interface CodeContext {
  id: string;
  language: CodeLanguage;
}

// POST /code body
export interface ExecuteCodeOptions {
  code: string;
  context?: {
    id: string;
    language: CodeLanguage;
  };
}

// POST /command body
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
