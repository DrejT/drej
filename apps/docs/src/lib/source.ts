import { coreDocs, workflowDocs } from "collections/server";
import { loader } from "fumadocs-core/source";

export const coreSource = loader({
  baseUrl: "/docs/core",
  source: coreDocs.toFumadocsSource(),
});

export const workflowSource = loader({
  baseUrl: "/docs/workflow",
  source: workflowDocs.toFumadocsSource(),
});
