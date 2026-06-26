import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { pollHealth } from "../src/docker.js";

describe("pollHealth", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves when server returns { status: 'healthy' }", async () => {
    globalThis.fetch = mock(async (_url: string | URL | Request) => {
      return new Response(JSON.stringify({ status: "healthy" }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await expect(pollHealth("http://localhost:8080/health", 5_000)).resolves.toBeUndefined();
  });

  it("throws after timeout if server never becomes healthy", async () => {
    globalThis.fetch = mock(async (_url: string | URL | Request) => {
      return new Response(JSON.stringify({ status: "starting" }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await expect(pollHealth("http://localhost:8080/health", 100)).rejects.toThrow(
      /did not become healthy/,
    );
  });

  it("throws after timeout if server is unreachable", async () => {
    globalThis.fetch = mock(async (_url: string | URL | Request) => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;

    await expect(pollHealth("http://localhost:8080/health", 100)).rejects.toThrow(
      /did not become healthy/,
    );
  });
});
