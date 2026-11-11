# AMS Builds — Web & App Development (ams-builds.online)

**Astro 4 + Tailwind CSS + built-in client-side CMS at `/admin/`** — pure static output (`dist/`) that deploys anywhere (Vercel, Cloudflare Workers/Pages static assets, Netlify, GitHub Pages, or local preview).

Services agency site: **custom business websites, Android apps, e-commerce and custom software** — with a zero-backend CMS at `/admin/`.

## ✨ Features

- ⚡ **Astro 4 static site** — all pages (including `/admin/`) are static HTML with sub-second loads and zero server runtime dependencies
- 🎨 **Tailwind CSS** — clean modern tech aesthetic, mobile-first responsive
- 🔐 **Built-in Client-Side CMS at `/admin/`** — no database, no Durable Object, no GitHub OAuth required:
  - Default credentials: **`admin`** / **`admin12345`**
  - ⚙️ **Site settings**: brand, contact, socials, homepage hero + stats, Google Search Console verification token, GA4 ID, AdSense toggle + publisher ID
  - **Blog / Pages / Projects**: create, edit, live Markdown preview, draft/publish, revert to repository defaults, download `.md` / `site.yml`
  - 🖼️ **Images**: upload images directly in the browser (stored in IndexedDB with `localStorage` fallback) and pick them from any media field
  - 💾 **Export & Backup**: export or import full JSON backups (including settings, content edits, and uploaded images), or reset to repository defaults
  - ⚡ **Instant Live Preview**: edits saved in `/admin/` apply immediately on the live site in that browser
- 🧭 **Dynamic navigation** — header/footer auto-pull CMS pages (`showInNav` / `showInFooter`, ordered by `navOrder`)
- 🔍 **SEO built-in** — meta, OpenGraph, Twitter cards, JSON-LD ProfessionalService schema, sitemap, RSS
- 💰 **AdSense-ready** — semantic markup, `AdSlot` units (placeholders until enabled in Site Settings)

## 📚 Full documentation

**→ See [GUIDE.md](./GUIDE.md)** for deployment, using `/admin/`, exporting backups / git updates, SEO/AdSense setup, and local development.

## 🚀 Quick start (local)

```bash
npm install
npm test          # unit + static build test suite
npm run dev       # dev server at http://localhost:4321
npm run build     # production static build → dist/
npm run preview   # build + preview dist/ locally on port 4321
```

## 📁 Structure

```
src/pages/admin.astro       # static admin shell (embeds baseline content + login + CMS app)
src/pages/cms-data.json.js  # emits baseline { entries, settings, media } JSON at /cms-data.json
src/lib/cms-store.mjs       # client-side CMS engine (auth, localStorage overrides, IndexedDB media, export/import)
src/lib/cms-live.mjs        # live public-site hydration when local CMS overrides exist
src/lib/admin-client.js     # admin SPA UI (vanilla JS + live Markdown preview)
src/lib/markdown-browser.mjs # safe client-side Markdown renderer
src/content/                # git-tracked Markdown/YAML baseline content
src/content/settings/       # site.yml — brand/contact/hero/Google defaults
src/components/             # SEO, Header, Footer, AdSlot, cards, Breadcrumbs, IntroOverlay
src/layouts/                # BaseLayout, PageLayout, BlogPostLayout, ProjectLayout
```
