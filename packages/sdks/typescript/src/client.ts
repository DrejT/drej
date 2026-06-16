export interface DrejClientOptions {
  baseUrl?: string;
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
}
