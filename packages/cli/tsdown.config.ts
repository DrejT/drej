import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  outDir: "dist",
  platform: "node",
  clean: true,
  banner: { js: "#!/usr/bin/env bun" },
  deps: { neverBundle: ["drej", "@drej/sqlite"] },
});
