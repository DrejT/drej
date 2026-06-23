"use client";

import { usePathname, useRouter } from "next/navigation";

const packages = [
  { value: "core", label: "Core SDK", sub: "drej" },
  { value: "workflow", label: "Workflow Builder", sub: "@drej/workflow" },
] as const;

export function PackageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const current = pathname.startsWith("/docs/workflow") ? "workflow" : "core";

  return (
    <div className="px-2 pb-3">
      <select
        value={current}
        onChange={(e) => router.push(`/docs/${e.target.value}`)}
        className="w-full rounded-md border border-fd-border bg-fd-background px-3 py-2 text-sm text-fd-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-fd-ring"
      >
        {packages.map((pkg) => (
          <option key={pkg.value} value={pkg.value}>
            {pkg.label} — {pkg.sub}
          </option>
        ))}
      </select>
    </div>
  );
}
