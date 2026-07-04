import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  site: "https://registry.drej.dev",
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
