# @drej/www

Marketing landing page for drej, deployed to [drej.dev](https://drej.dev).

Astro, static output, no server-side logic — just the pitch, package tabs, and links out to the docs and registry sites.

## Structure

```
src/
  pages/index.astro       — the single page
  components/
    Nav.astro              — top nav
    Hero.astro             — hero section + primary CTA
    Pillars.astro          — key value props
    Features.astro         — package tabs / feature breakdown
    LedgerStrip.astro      — ledger/audit-trail visual
    Footer.astro
  layouts/Base.astro       — shared HTML shell
  styles/global.css
```

## Commands

```bash
bun run dev      # astro dev
bun run build    # astro build -> dist/
bun run preview  # preview the production build locally
bun run deploy   # build + wrangler pages deploy (project: drej-www)
```
