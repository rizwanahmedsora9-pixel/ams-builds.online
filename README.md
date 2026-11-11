# AMS Builds — Web & App Development (ams-builds.online)

**Astro 4 + Tailwind CSS + a built-in admin at `/admin/`** — served by **Cloudflare Workers** (`wrangler.jsonc` + `worker/`). Content lives in Cloudflare storage (a Durable Object) and the Markdown files under `src/content/`; no GitHub login, no third-party CMS.

Services agency site: **custom business websites, Android apps, e-commerce and custom software** — manageable end-to-end from the admin.

## ✨ Features

- ⚡ **Astro 4 site** — content pages are static HTML (sub-second loads), the admin and its API run on a small Worker
- 🎨 **Tailwind CSS** — clean modern tech aesthetic, mobile-first responsive
- 🔐 **Admin at `/admin/`** — simple username/password sign-in (first login sets the credentials), then manage **everything** without code:
  - ⚙️ **Site settings** (singleton): brand, contact, socials, homepage hero + stats, **Google Search Console verification token**, **GA4 ID**, **AdSense toggle + publisher ID**
  - **Pages / Projects / Blog** with per-entry **SEO overrides** (SEO title, description, OG image, noindex), drafts, and title-derived slugs
  - 🖼️ **Image uploads** — stored in Cloudflare, served from `/images/uploads/…`
  - 🚀 **Publish button** — triggers a Cloudflare rebuild so the live site picks up saved changes
- 🧭 **Dynamic navigation** — header/footer auto-pull CMS pages (`showInNav` / `showInFooter`, ordered by `navOrder`)
- 🔍 **SEO built-in** — meta, OpenGraph, Twitter cards, JSON-LD ProfessionalService schema, sitemap, RSS
- 💰 **AdSense-ready** — semantic markup, `AdSlot` units (placeholders until enabled in Site Settings)
- ☁️ **Zero-Git editing** — the admin never touches GitHub; git-tracked files in `src/content/` remain the starting point and can still be edited by hand

## 📚 Full documentation

**→ See [GUIDE.md](./GUIDE.md)** for: how publishing works → one-time Cloudflare setup (rebuild hook) → using the admin → local development → backups → troubleshooting.

## 🚀 Quick start (local)

```bash
npm install
npm test          # unit + build test suite
npm run dev       # dev server at http://localhost:4321 (admin works against a local .dev-cms/ store)
npm run build     # production build → dist/
npx wrangler dev  # run the real Worker + Durable Object locally (after npm run build)
```

## 📁 Structure

```
src/pages/admin.astro   # admin shell (login + app frame)
src/pages/admin/api/    # admin REST API (login, content, entries, media, publish, export)
src/lib/                # content source, stores, auth, fields, markdown rendering
worker/cms-do.js        # CmsSite Durable Object — entries, images, credentials, sessions
worker/main.js          # Worker entry: Astro app + DO class export
wrangler.jsonc          # Worker, static assets, Durable Object binding (prod + previews)
src/content/            # git-tracked Markdown/YAML (the pre-CMS baseline content)
src/content/settings/   # site.yml — brand/contact/hero/Google defaults
src/components/         # SEO, Header, Footer (settings-driven), AdSlot, cards, Breadcrumbs
src/layouts/            # BaseLayout (injects AdSense/GA4 from settings), Page/BlogPost/Project
```

## ⚠️ Before using `/admin/` in production

1. Merge/deploy this code to `main` — Cloudflare Workers Builds rebuilds the live site automatically.
2. **One-time:** create a Deploy Hook (Workers → ams-builds-online → Settings → Builds → Deploy Hooks, branch `main`) and save its URL as the secret `CMS_DEPLOY_HOOK` (Settings → Variables and Secrets). Until then, saving works but the **Publish** button explains that the hook is missing.
3. Open `https://ams-builds.online/admin/` → sign in with your chosen username/password (the first attempt sets them) → **Site Settings** → real contact details + Google IDs → **Publish**.

Contact/placeholders to replace (via admin → Site Settings): phone `+92 300 0000000`, `hello@ams-builds.online`, address (currently "Gujrat, Punjab, Pakistan").
