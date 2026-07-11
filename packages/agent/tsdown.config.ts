import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  platform: "node",
  clean: true,
  deps: { neverBundle: ["@drej/core", "drej", "@drej/sqlite"] },
  // pi-bridge.js is read at runtime relative to this module's own location (see
  // adapters/pi.ts) rather than bundled as a string — copy it alongside index.mjs
  // so that resolution works identically in dev (src/adapters/) and in the
  // published package (dist/).
  copy: ["src/adapters/pi-bridge.js"],
});
