import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";

export default function DocsPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout tree={source.pageTree} nav={{ title: "drej" }}>
      {children}
    </DocsLayout>
  );
}
