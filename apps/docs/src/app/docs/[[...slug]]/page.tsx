import { DocsPage, DocsBody } from "fumadocs-ui/layouts/docs/page";
import { source } from "@/lib/source";
import { notFound } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsBody>
        <h1 className="text-3xl font-bold mb-4">{page.data.title}</h1>
        <MDX components={{ ...defaultMdxComponents }} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.getPages().map((page) => ({
    slug: page.slugs,
  }));
}
