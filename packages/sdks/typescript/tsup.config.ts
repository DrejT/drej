import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: {
    resolve: true,
    compilerOptions: { ignoreDeprecations: "6.0" },
  },
  outDir: "dist",
  target: "node20",
  platform: "node",
  bundle: true,
  noExternal: ["@drej/core", "@drej/opensandbox"],
  tsconfig: "tsconfig.build.json",
});
