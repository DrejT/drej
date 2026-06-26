import { describe, it, expect } from "bun:test";
import { validateRegistryItem } from "../src/schema.js";

describe("validateRegistryItem", () => {
  it("accepts a valid minimal item", () => {
    const item = validateRegistryItem({
      name: "my-sandbox",
      image: "node:22",
      resources: { cpu: "500m", memory: "256Mi" },
    });
    expect(item.name).toBe("my-sandbox");
    expect(item.image).toBe("node:22");
  });

  it("accepts image as an object { uri: string }", () => {
    const item = validateRegistryItem({
      name: "my-sandbox",
      image: { uri: "ghcr.io/org/image" },
      resources: { cpu: "500m", memory: "256Mi" },
    });
    expect(item.image).toEqual({ uri: "ghcr.io/org/image" });
  });

  it("accepts all optional fields", () => {
    const item = validateRegistryItem({
      name: "full-sandbox",
      image: "ubuntu:22.04",
      resources: { cpu: "1", memory: "512Mi", gpu: "1" },
      title: "Full Sandbox",
      description: "A complete sandbox",
      author: "alice",
      categories: ["dev", "test"],
      env: { NODE_ENV: "production" },
      setup: ["apt-get update", "apt-get install -y curl"],
      snapshotId: "snap-123",
      ports: [3000, 8080],
      metadata: { team: "infra" },
      registryDependencies: ["https://example.com/dep.json"],
    });
    expect(item.title).toBe("Full Sandbox");
    expect(item.setup).toEqual(["apt-get update", "apt-get install -y curl"]);
    expect(item.ports).toEqual([3000, 8080]);
    expect(item.registryDependencies).toEqual(["https://example.com/dep.json"]);
  });

  it("throws with 'name' in message when name is missing", () => {
    expect(() => validateRegistryItem({
      image: "node:22",
      resources: { cpu: "500m", memory: "256Mi" },
    })).toThrow(/name/);
  });

  it("throws with 'image' in message when image is missing", () => {
    expect(() => validateRegistryItem({
      name: "my-sandbox",
      resources: { cpu: "500m", memory: "256Mi" },
    })).toThrow(/image/);
  });

  it("throws with 'resources' in message when resources is missing", () => {
    expect(() => validateRegistryItem({
      name: "my-sandbox",
      image: "node:22",
    })).toThrow(/resources/);
  });

  it("throws with 'cpu' in message when resources.cpu is missing", () => {
    expect(() => validateRegistryItem({
      name: "my-sandbox",
      image: "node:22",
      resources: { memory: "256Mi" },
    })).toThrow(/cpu/);
  });

  it("throws with 'memory' in message when resources.memory is missing", () => {
    expect(() => validateRegistryItem({
      name: "my-sandbox",
      image: "node:22",
      resources: { cpu: "500m" },
    })).toThrow(/memory/);
  });

  it("rejects null", () => {
    expect(() => validateRegistryItem(null)).toThrow();
  });

  it("rejects a string", () => {
    expect(() => validateRegistryItem("not-an-object")).toThrow();
  });

  it("rejects a number", () => {
    expect(() => validateRegistryItem(42)).toThrow();
  });
});
