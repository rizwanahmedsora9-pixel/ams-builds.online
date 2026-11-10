# AMS Builds — Web & App Development (ams-builds.online)

**Astro 4 + Tailwind CSS + Decap CMS** — static, AdSense-friendly site with a built-in GitHub OAuth bridge for **Cloudflare Workers** (`wrangler.jsonc` + `worker/`) and **Vercel** (`vercel.json` + `api/`).

Services agency site: **custom business websites, Android apps, e-commerce and custom software** — manageable end-to-end from the CMS.

## ✨ Features

- ⚡ **Astro 4 static site** — zero unnecessary JS, sub-second loads, AdSense-friendly
- 🎨 **Tailwind CSS** — clean modern tech aesthetic, mobile-first responsive
- ✍️ **Decap CMS at `/admin/`** — manage **everything** without code:
  - ⚙️ **Site Settings** (singleton): brand, contact, socials, homepage hero + stats, **Google Search Console verification token**, **GA4 ID**, **AdSense toggle + publisher ID**
  - **Pages / Projects / Blog** collections with per-entry **SEO overrides** (SEO title, description, OG image, noindex) and title-derived slugs
- 🧭 **Dynamic navigation** — header/footer auto-pull CMS pages (`showInNav` / `showInFooter`, ordered by `navOrder`)
- 🔍 **SEO built-in** — meta, OpenGraph, Twitter cards, JSON-LD ProfessionalService schema, sitemap, RSS
- 💰 **AdSense-ready** — semantic H1/H2/H3, `AdSlot` units in blog/sidebar/pages (placeholders until enabled in CMS)
- ☁️ **Cloudflare Workers + ▲ Vercel ready** — `wrangler.jsonc` + `worker/` handles static assets and `/auth` + `/callback` on Cloudflare Workers (`ams-builds-online`), while `vercel.json` + `api/` handles Vercel; `_headers` and `robots.txt` included

## 📚 Full documentation

**→ See [GUIDE.md](./GUIDE.md)** for the complete step-by-step: deploy to Cloudflare Workers or Vercel → configure the GitHub OAuth App → use the CMS at `/admin/` → Search Console → AdSense → troubleshooting → launch checklist.

## 🚀 Quick start (local)

```bash
npm install
npm test          # run unit & CMS/OAuth test suite
npm run dev       # dev server at http://localhost:4321
npm run build     # production build → dist/
npm run preview   # serve the build locally
```

## 📁 Structure

```
public/admin/          # Decap CMS (index.html + config.yml — collections & Site Settings)
public/images/uploads/ # CMS media uploads
worker/                # Cloudflare Worker OAuth bridge + shared OAuth engine
api/                   # Vercel serverless OAuth adapter (uses worker/oauth.js)
wrangler.jsonc         # Cloudflare Workers Static Assets + Worker configuration
src/content/settings/  # site.yml — ALL brand/contact/hero/Google config (editable in CMS)
src/content/pages|projects|blog/   # CMS content
src/components/        # SEO, Header, Footer (settings-driven), AdSlot, cards, Breadcrumbs
src/layouts/           # BaseLayout (injects AdSense/GA4 from settings), Page/BlogPost/Project
src/pages/             # index, dynamic [...slug], blog, projects, 404, rss.xml.js
```

## ⚠️ Before using `/admin/` in production

1. Deploy via **Cloudflare Workers** (`ams-builds-online`, automatic via Workers Builds + `wrangler.jsonc`) or **Vercel** (`vercel.json`).
2. Create a GitHub OAuth App with **Authorization callback URL** `<YOUR_SITE_ORIGIN>/callback` (for example `https://ams-builds-online.rizwanahmedsora9.workers.dev/callback` or `https://ams-builds.online/callback`) and set `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` in Cloudflare Workers **Variables and Secrets** (or Vercel **Environment Variables**) — see GUIDE.md Part 5.
3. Open `<YOUR_SITE_ORIGIN>/admin/` → sign in with GitHub → **Site Settings** → add real contact details and optional Google IDs → publish.

Contact/placeholders to replace (or edit via CMS → Site Settings): phone `+92 300 0000000`, `hello@ams-builds.online`, address (currently "Gujrat, Punjab, Pakistan").
