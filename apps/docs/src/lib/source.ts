import { coreDocs, workflowDocs, drejxDocs, agentDocs } from "collections/server";
import { loader } from "fumadocs-core/source";

export const coreSource = loader({
  baseUrl: "/docs/core",
  source: coreDocs.toFumadocsSource(),
});

export const workflowSource = loader({
  baseUrl: "/docs/workflow",
  source: workflowDocs.toFumadocsSource(),
});

export const drejxSource = loader({
  baseUrl: "/docs/drejx",
  source: drejxDocs.toFumadocsSource(),
});

export const agentSource = loader({
  baseUrl: "/docs/agent",
  source: agentDocs.toFumadocsSource(),
});
