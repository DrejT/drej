import { describe, expect, it, vi, beforeEach } from "vitest";
import { Drej } from "../src/client.ts";
import { SandboxStatus, type IStorageAdapter, type SandboxDetails } from "@drej/core";

function makeAdapter(overrides: Partial<IStorageAdapter> = {}): IStorageAdapter {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    readAll: vi.fn().mockResolvedValue([]),
    lastCheckpoint: vi.fn().mockResolvedValue(null),
    listSandboxDetails: vi.fn().mockResolvedValue([]),
    listAllSandboxDetails: vi.fn().mockResolvedValue([]),
    getSandboxDetails: vi.fn().mockResolvedValue(null),
    deleteSandbox: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeClient(adapter: IStorageAdapter, opts: { maxConcurrency?: number } = {}) {
  return new Drej({
    baseUrl: "http://localhost:8080",
    adapter,
    ...opts,
  });
}

// ── connect / close ────────────────────────────────────────────────────────

describe("Drej.connect / close", () => {
  it("calls adapter.connect on connect()", async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter);
    await client.connect();
    expect(adapter.connect).toHaveBeenCalledOnce();
  });

  it("calls adapter.close on close()", async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter);
    await client.close();
    expect(adapter.close).toHaveBeenCalledOnce();
  });
});

// ── sessions delegation ────────────────────────────────────────────────────

describe("Drej.sandboxes", () => {
  let adapter: IStorageAdapter;
  let client: Drej;

  beforeEach(() => {
    adapter = makeAdapter();
    client = makeClient(adapter);
  });

  it("sessions.list() delegates to listAllSandboxDetails()", async () => {
    const details: SandboxDetails[] = [
      { name: "ci", sandboxId: "s1", status: SandboxStatus.Completed, startedAt: 1000, execCount: 2 },
    ];
    (adapter.listAllSandboxDetails as ReturnType<typeof vi.fn>).mockResolvedValue(details);

    const result = await client.sandboxes.list();
    expect(adapter.listAllSandboxDetails).toHaveBeenCalledWith(undefined);
    expect(result).toEqual(details);
  });

  it("sessions.list(opts) forwards opts", async () => {
    await client.sandboxes.list({ limit: 5, status: SandboxStatus.Running });
    expect(adapter.listAllSandboxDetails).toHaveBeenCalledWith({ limit: 5, status: SandboxStatus.Running });
  });

  it("sessions.listByName(name) delegates to listSandboxDetails(name)", async () => {
    await client.sandboxes.listByName("ci");
    expect(adapter.listSandboxDetails).toHaveBeenCalledWith("ci", undefined);
  });

  it("sessions.listByName(name, opts) forwards opts", async () => {
    await client.sandboxes.listByName("ci", { limit: 3 });
    expect(adapter.listSandboxDetails).toHaveBeenCalledWith("ci", { limit: 3 });
  });

  it("sessions.get(name, sandboxId) delegates to getSandboxDetails()", async () => {
    const details: SandboxDetails = {
      name: "ci", sandboxId: "s1", status: SandboxStatus.Completed, startedAt: 1000, execCount: 1,
    };
    (adapter.getSandboxDetails as ReturnType<typeof vi.fn>).mockResolvedValue(details);

    const result = await client.sandboxes.get("ci", "s1");
    expect(adapter.getSandboxDetails).toHaveBeenCalledWith("ci", "s1");
    expect(result).toEqual(details);
  });

  it("sessions.get() returns null for unknown session", async () => {
    const result = await client.sandboxes.get("ci", "no-such");
    expect(result).toBeNull();
  });

  it("sessions.delete(name, sandboxId) delegates to deleteSandbox()", async () => {
    await client.sandboxes.delete("ci", "s1");
    expect(adapter.deleteSandbox).toHaveBeenCalledWith("ci", "s1");
  });
});

// ── concurrency semaphore ──────────────────────────────────────────────────

describe("Drej concurrency slot", () => {
  it("_acquireSlot / _releaseSlot tracks active count", async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter, { maxConcurrency: 2 });

    await (client as any)._acquireSlot();
    expect((client as any)._activeCount).toBe(1);

    await (client as any)._acquireSlot();
    expect((client as any)._activeCount).toBe(2);

    (client as any)._releaseSlot();
    expect((client as any)._activeCount).toBe(1);
  });

  it("third acquire blocks until a slot is released", async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter, { maxConcurrency: 2 });

    await (client as any)._acquireSlot();
    await (client as any)._acquireSlot();

    let resolved = false;
    const pending = (client as any)._acquireSlot().then(() => { resolved = true; });

    // Not yet resolved — no free slot
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Release one slot — pending acquire should resolve
    (client as any)._releaseSlot();
    await pending;
    expect(resolved).toBe(true);
  });

  it("no concurrency limit allows unlimited slots", async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter); // no maxConcurrency

    for (let i = 0; i < 10; i++) {
      await (client as any)._acquireSlot();
    }
    expect((client as any)._activeCount).toBe(10);
  });
});
