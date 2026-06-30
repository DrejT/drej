import { createSearchAPI } from "fumadocs-core/search/server";
import { coreSource, workflowSource, drejxSource, agentSource } from "@/lib/source";

export const dynamic = "force-static";

const allPages = [
  ...coreSource.getPages(),
  ...workflowSource.getPages(),
  ...drejxSource.getPages(),
  ...agentSource.getPages(),
];

export const { staticGET: GET } = createSearchAPI("advanced", {
  indexes: allPages.map((page) => ({
    id: page.url,
    title: page.data.title,
    description: page.data.description,
    url: page.url,
    structuredData: page.data.structuredData,
  })),
});
