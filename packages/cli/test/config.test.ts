import { describe, it, expect } from "bun:test";
import { serverConfigContent, serverConfigPath, configPath } from "../src/config.js";

describe("serverConfigContent", () => {
  it("contains [server]", () => {
    expect(serverConfigContent()).toContain("[server]");
  });

  it("contains [runtime]", () => {
    expect(serverConfigContent()).toContain("[runtime]");
  });

  it("contains [docker]", () => {
    expect(serverConfigContent()).toContain("[docker]");
  });

  it("contains eip = \"http://localhost:8080\"", () => {
    expect(serverConfigContent()).toContain(`eip = "http://localhost:8080"`);
  });

  it("contains type = \"docker\"", () => {
    expect(serverConfigContent()).toContain(`type = "docker"`);
  });

  it("contains network_mode = \"bridge\"", () => {
    expect(serverConfigContent()).toContain(`network_mode = "bridge"`);
  });

  it("contains port = 8080", () => {
    expect(serverConfigContent()).toContain("port = 8080");
  });
});

describe("serverConfigPath", () => {
  it("ends with server.toml", () => {
    expect(serverConfigPath()).toMatch(/server\.toml$/);
  });
});

describe("configPath", () => {
  it("equals .drej/config.json", () => {
    expect(configPath()).toBe(".drej/config.json");
  });
});
