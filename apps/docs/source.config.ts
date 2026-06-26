import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const coreDocs = defineDocs({ dir: "content/docs/core" });
export const workflowDocs = defineDocs({ dir: "content/docs/workflow" });
export const drejxDocs = defineDocs({ dir: "content/docs/drejx" });

export default defineConfig();
