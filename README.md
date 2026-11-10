# AMS Builds — Web & App Development (ams-builds.online)

**Astro 4 + Tailwind CSS + Decap CMS** — production-ready, AdSense-friendly, Cloudflare Pages ready.

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
- ☁️ **Cloudflare Pages** — static output, security `_headers`, `robots.txt`

## 📚 Full documentation

**→ See [GUIDE.md](./GUIDE.md)** for the complete step-by-step: push to GitHub → Cloudflare Pages → custom domain → CMS/OAuth setup → Search Console → AdSense → content strategy → troubleshooting → launch checklist.

## 🚀 Quick start (local)

```bash
npm install
npm run dev       # dev server at http://localhost:4321
npm run build     # production build → dist/
npm run preview   # serve the build locally
```

## 📁 Structure

```
public/admin/          # Decap CMS (index.html + config.yml — collections & Site Settings)
public/images/uploads/ # CMS media uploads
src/content/settings/  # site.yml — ALL brand/contact/hero/Google config (editable in CMS)
src/content/pages|projects|blog/   # CMS content
src/components/        # SEO, Header, Footer (settings-driven), AdSlot, cards, Breadcrumbs
src/layouts/           # BaseLayout (injects AdSense/GA4 from settings), Page/BlogPost/Project
src/pages/             # index, dynamic [...slug], blog, projects, 404, rss.xml.js
```

## ⚠️ Before deploy

1. Push to GitHub; connect repo in **Cloudflare Pages** (build: `npm run build`, output: `dist`, `NODE_VERSION=20`) — details in GUIDE.md Part 4
2. Set your repo + OAuth `base_url` in `public/admin/config.yml` — GUIDE.md Part 5
3. Open `/admin/` → **Site Settings** → paste real contact details (+ optional GSC token / GA4 / AdSense) → publish

Contact/placeholders to replace (or edit via CMS → Site Settings): phone `+92 300 0000000`, `hello@ams-builds.online`, address (currently "Gujrat, Punjab, Pakistan").
