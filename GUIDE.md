# AMS Builds — Complete Guide

**Built-in client-side CMS at `/admin/` — zero server backend, deploys statically to Vercel, Cloudflare, or any static host.**

## 1. Logging in to `/admin/`

Open `/admin/` on the site (e.g. `https://ams-builds.online/admin/` or `http://localhost:4321/admin/`) and sign in with:

- **Username:** `admin`
- **Password:** `admin12345`

## 2. How the client-side CMS works

1. **Repository baseline (`src/content/` + `src/pages/cms-data.json.js`):** Every build compiles all Markdown posts, projects, pages, and `site.yml` settings into static HTML plus a baseline `/cms-data.json` manifest.
2. **Browser storage (`localStorage` + `IndexedDB`):** When you create, edit, or delete content or upload images in `/admin/`, changes are saved locally in your browser (`ams_cms_store_v1` + `ams_cms_media_db`).
3. **Instant live preview:** Visiting any public page in that browser hydrates live with your saved changes — including newly created `/blog/<slug>/`, `/projects/<slug>/`, or `/<slug>/` routes.
4. **Permanent deploys via Git:** Use **Export & Backup** in `/admin/` (or **Download .md** / **Download site.yml** inside any editor) to export files and commit them to `src/content/` when you want changes baked permanently into production builds for all visitors.

## 3. Deploying to Vercel (or Cloudflare / Netlify)

The project uses Astro's `output: 'static'` configuration (`astro.config.mjs`):

- **Build command:** `npm run build`
- **Output directory:** `dist`
- **No server adapter or environment variables required.**

For Cloudflare static hosting (`wrangler.jsonc`), `npx wrangler deploy` serves `./dist` directly with `404-page` routing.

## 4. Local development

```bash
npm install
npm test          # runs all unit, intro-overlay, and Astro static build tests
npm run dev       # dev server at http://localhost:4321
npm run build     # builds static output to dist/
npm run preview   # serves dist/ locally on http://localhost:4321
```

## 5. First-time content checklist

1. Sign in at `/admin/` (`admin` / `admin12345`).
2. Update **Site settings** (real phone, WhatsApp, email, address, hours, Google verification token, GA4 ID, AdSense ID).
3. Review **Pages**, **Projects**, and **Blog** posts, and replace sample case studies as needed.
4. Download `site.yml` / `.md` files (or export a full `.json` backup) to commit updates into git and keep a backup.
