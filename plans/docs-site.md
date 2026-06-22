# Docs Site — Fumadocs + Next.js + Cloudflare Pages

## Overview

Add a documentation site at `apps/docs/` as a Bun workspace member. Built
with Fumadocs (MDX-based docs framework on Next.js App Router), exported as
a static site, and deployed to Cloudflare Pages.

---

## Tech decisions

| Decision | Choice | Reason |
|---|---|---|
| Framework | Fumadocs (fumadocs-ui + fumadocs-mdx) | First-class Next.js App Router support, good default UI, Orama search built-in |
| Next.js output | `output: 'export'` (static) | Docs don't need a server; static export works on any CDN with no adapter overhead |
| Search | Orama (client-side mode) | Static export can't run search API routes; Orama's client-side index is fast and bundled at build time |
| Hosting | Cloudflare Pages | Free tier, global CDN, instant deploys from `out/` static dir |
| CI/CD | GitHub Actions | Build on push to `main`, deploy to Cloudflare Pages via wrangler action |

> **Why not @cloudflare/next-on-pages?** The Workers adapter adds operational
> complexity and costs. For a pure docs site there is no server-side work to do
> — static export is simpler and faster.

---

## Repo structure

```
apps/
  docs/
    app/
      layout.tsx            # Root layout (RootProvider, ThemeProvider)
      page.tsx              # / redirect → /docs
      docs/
        layout.tsx          # Sidebar, nav, search
        [[...slug]]/
          page.tsx          # Dynamic MDX page renderer
      api.ts                # Orama search index route (build-time generated)
    content/
      docs/                 # All MDX source files (mirrors nav tree)
        index.mdx           # Redirects or landing
        getting-started/
          index.mdx
          installation.mdx
          quickstart.mdx
          how-it-works.mdx
        concepts/
          workflows.mdx
          sandboxes.mdx
          steps.mdx
          refs-and-state.mdx
          event-stream.mdx
          storage-adapters.mdx
        building/
          exec.mdx
          exec-code.mdx
          file-ops.mdx
          control-flow.mdx
          snapshots.mdx
        timeouts-and-cancellation.mdx
        error-handling.mdx
        run-management.mdx
        observability.mdx
        adapters/
          sqlite.mdx
          postgres.mdx
          custom.mdx
        api-reference/
          drej-client.mdx
          workflow-run.mdx
          run-options.mdx
          builder.mdx
          errors.mdx
          storage-types.mdx
        deployment.mdx
    lib/
      source.ts             # fumadocs-mdx loader wired to content/docs/
    components/             # Any custom MDX components (e.g. CodeTabs)
    public/
    next.config.ts
    package.json
    tsconfig.json
```

Add `apps/docs` to the root workspace:

```json
"workspaces": [
  "packages/core",
  "packages/opensandbox",
  "packages/sdks/typescript",
  "packages/adapters/postgres",
  "packages/adapters/sqlite",
  "packages/adapters/otel",
  "examples/*",
  "tests/integration",
  "apps/docs"
]
```

---

## Content map

### Getting Started
| Page | Goal |
|---|---|
| What is drej? | 3-sentence pitch + architecture diagram (drej → OpenSandbox → Docker) |
| Installation | `bun add drej @drej/sqlite`, connect/close boilerplate |
| Quick start | Hello-world workflow end-to-end, show the for-await event loop |
| How it works | Mental model: WorkflowBuilder → StepDef[] → Workflow engine → ledger + stream |

### Core Concepts
| Page | Key points |
|---|---|
| Workflows | `workflow(name).sandbox(...).build()`, `DrejClient.run()`, `WorkflowRun` |
| Sandboxes | Image spec, resource limits, auto-created/deleted, `tail -f /dev/null` entrypoint |
| Steps | StepType enum, leaf vs control-flow, how steps chain via workflow state |
| Refs & workflow state | `Ref<T>`, template literal interpolation, `finalState[ref.key]` |
| Event stream | `for await`, LedgerEvent enum, exec_event payload shape |
| Storage adapters | `IStorageAdapter`, connect/close lifecycle, ledger persistence |

### Building Workflows
| Page | Key points |
|---|---|
| exec / execCode | `strict`, `capture`, `cwd`, `envs`, `timeoutMs`; code-interpreter image requirement |
| File operations | All 9 file ops, which return Ref vs `this`, interpolation in paths |
| Control flow | `retry` + backoff, `when` + Predicate, `forEach` + concurrency, `parallel` |
| Snapshots | `s.snapshot()` inline vs `snapshotConfig` on `client.run()`, `replayFromSnapshot` |

### Timeouts & Cancellation
Single page covering all four patterns from the cancellation example:
- Per-step `timeoutMs` → `StepTimeoutError`
- Global `RunOptions.stepTimeoutMs`
- `run.cancel()` → clean stop, status `"cancelled"`
- `break` from `for await` → same as cancel
- External `AbortSignal` via `RunOptions.signal`

### Error Handling
- Default non-strict exec (exitCode in state, use `when()` to branch)
- `strict: true` → `CommandError` with `.exitCode`
- `StepTimeoutError`, `SandboxError`, `ExecConnectionError`
- Saga rollback — automatic on any thrown error, steps run in reverse

### Run Management
- `resumeRun()` — checkpoint-based resumption after crash
- `listRunDetails` / `getRunDetails` / `deleteRun`
- `RunDetails` shape, `RunStatus` enum

### Observability
- `WorkflowHooks` interface (all 7 callbacks)
- `@drej/otel` — `otelHooks(tracer)` span structure

### Storage Adapters
- SQLite — zero-config, WAL mode, `":memory:"` for tests
- Postgres — connection string, migrations, pooling
- Custom — `IStorageAdapter` interface contract

### API Reference
Auto-generated or hand-curated pages matching each exported symbol. Can be
populated incrementally — start with `DrejClient` and `WorkflowRun` since those
are the primary user-facing classes.

---

## Setup steps

### 1. Scaffold the app

```bash
cd apps
bunx create-next-app@latest docs --typescript --app --no-src-dir --no-tailwind
```

Then install Fumadocs:

```bash
cd docs
bun add fumadocs-ui fumadocs-mdx fumadocs-core
bun add -d @types/node
```

### 2. Configure Next.js for static export

```ts
// apps/docs/next.config.ts
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

export default withMDX({
  output: "export",
  reactStrictMode: true,
});
```

### 3. Wire fumadocs-mdx

```ts
// apps/docs/lib/source.ts
import { loader } from "fumadocs-core/source";
import { createMDXSource } from "fumadocs-mdx";
import { docs, meta } from "@/.source";   // generated by fumadocs-mdx

export const source = loader({
  baseUrl: "/docs",
  source: createMDXSource(docs, meta),
});
```

`fumadocs-mdx` generates `@/.source` at build time from the MDX files under `content/docs/`.

### 4. App layout and page

```tsx
// apps/docs/app/layout.tsx
import { RootProvider } from "fumadocs-ui/provider";
import "fumadocs-ui/style.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
```

```tsx
// apps/docs/app/docs/[[...slug]]/page.tsx
import { source } from "@/lib/source";
import { DocsPage, DocsBody } from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";

export default async function Page({ params }: { params: { slug?: string[] } }) {
  const page = source.getPage(params.slug);
  if (!page) notFound();
  const { body: MDX } = await page.data.load();
  return (
    <DocsPage toc={page.data.toc}>
      <DocsBody>
        <MDX components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}
```

### 5. Sidebar layout

```tsx
// apps/docs/app/docs/layout.tsx
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout tree={source.pageTree} nav={{ title: "drej" }}>
      {children}
    </DocsLayout>
  );
}
```

### 6. Search (Orama client-side)

Fumadocs ships Orama search. For static export, use the client-side mode:

```ts
// apps/docs/app/docs/layout.tsx — add to DocsLayout
import { OramaSearchDialog } from "fumadocs-ui/components/dialog/search-orama";
// pass searchToggle={{ enabled: true }} and SearchDialog={OramaSearchDialog}
```

Full Orama setup requires generating the search index at build time via the
`fumadocs-mdx` post-install script. Documented in Fumadocs' Orama guide.

---

## Cloudflare Pages deployment

### Manual first deploy

```bash
# from apps/docs
bun run build          # produces out/
bunx wrangler pages deploy out --project-name drej-docs
```

### GitHub Actions (CI/CD)

```yaml
# .github/workflows/deploy-docs.yml
name: Deploy docs

on:
  push:
    branches: [main]
    paths:
      - "apps/docs/**"
      - "packages/**"      # rebuild if SDK types change

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run build
        working-directory: apps/docs
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy apps/docs/out --project-name=drej-docs
```

Secrets needed in GitHub repo settings:
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with Pages edit permission
- `CLOUDFLARE_ACCOUNT_ID` — from Cloudflare dashboard

---

## Phased rollout

### Phase 1 — Scaffold + Getting Started (ship something)
- `apps/docs/` created, Fumadocs wired, Cloudflare deploy working
- Write: What is drej, Installation, Quick start
- Deploy to a `drej-docs.pages.dev` subdomain

### Phase 2 — Core Concepts + Building
- Write all concept pages and building workflow pages
- Set up custom MDX components: `CodeTabs` for multi-language snippets,
  `Step` for numbered setup flows

### Phase 3 — API Reference
- Hand-curate `DrejClient`, `WorkflowRun`, and `RunOptions` pages
- Consider `fumadocs-typedoc` or a custom script to extract JSDoc → MDX for
  the builder methods

### Phase 4 — Polish
- Custom theme / brand colours (Fumadocs uses CSS variables)
- Add `og:image` metadata
- Wire a custom domain (docs.drej.dev or similar)
- Add `<Callout>` components for important warnings (e.g. execd readiness,
  `:memory:` adapter for tests only)
