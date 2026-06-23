import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { coreSource } from "@/lib/source";
import { PackageSwitcher } from "@/components/package-switcher";

export default function CoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      tree={coreSource.pageTree}
      nav={{ title: "drej", url: "/" }}
      themeSwitch={{ enabled: false }}
      searchToggle={{ enabled: true }}
      sidebar={{ banner: <PackageSwitcher /> }}
    >
      {children}
    </DocsLayout>
  );
}
