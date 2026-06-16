export interface DrejClientOptions {
  baseUrl?: string;
}

export interface SandboxRunResult {
  id: string;
  code: string;
  status: "queued";
}

export class DrejClient {
  private baseUrl: string;

  constructor(options: DrejClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://localhost:3000";
  }

  async health(): Promise<{ healthy: boolean }> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`drej API error: ${res.status}`);
    return res.json();
  }

  async run(code: string): Promise<SandboxRunResult> {
    const res = await fetch(`${this.baseUrl}/sandbox/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error(`drej API error: ${res.status}`);
    return res.json();
  }
}
