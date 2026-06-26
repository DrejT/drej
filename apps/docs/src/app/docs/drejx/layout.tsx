import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { drejxSource } from "@/lib/source";
import { PackageSwitcher } from "@/components/package-switcher";

export default function DrejxLayout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      tree={drejxSource.pageTree}
      nav={{ title: "drej", url: "/" }}
      themeSwitch={{ enabled: false }}
      searchToggle={{ enabled: true }}
      sidebar={{ banner: <PackageSwitcher key="package-switcher" /> }}
    >
      {children}
    </DocsLayout>
  );
}
