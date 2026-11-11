# AMS Builds — Complete Guide

**The built-in admin at `/admin/` runs the whole site — no GitHub, no third-party CMS.**

This guide covers: how the system works → the one-time Cloudflare setup → using the admin → local development → Google/Search Console/AdSense → backups → troubleshooting → launch checklist.

> **How the system works (30 seconds)**
> Content pages are static HTML built from Markdown/YAML. The admin at `/admin/` signs you in with a username/password (no GitHub), saves edits to a Cloudflare **Durable Object** (a database attached to the site's Worker), and its **Publish** button triggers a Cloudflare rebuild so the live site picks up the changes.
>
> **You edit in /admin → Save (stored instantly) → Publish → Cloudflare rebuilds → live site updated.**

---

## Part 1 — What exactly can I manage from the admin?

Everything below is editable at `https://ams-builds.online/admin/`:

| Admin section | What you control |
|---|---|
| **⚙️ Site settings** (singleton) | Site name, tagline, logo text/initial, short description, phone, WhatsApp, email, address, opening hours, price range, social links (Facebook/Instagram/LinkedIn/YouTube/GitHub/X), **Google Search Console verification token**, **GA4 measurement ID**, **AdSense enable + publisher ID**, homepage hero (badge, H1, subtitle, CTA text/link, hero image), default social-share (OG) image, stats row ("50+ Projects…") |
| **Pages** | About / Services / Contact / Privacy / Terms — title, SEO description, hero title/subtitle, featured image, nav order, show in nav / show in footer, draft, plus per-page SEO overrides (SEO title, SEO description, OG image, noindex) |
| **Projects** | Case studies — title, description, client, category (web/android/software/ecommerce), technologies, cover image, featured-on-homepage flag, date, results, live URL, body — plus SEO overrides |
| **Blog** | Articles — title, description, publish/updated dates, author, tags, hero image, featured flag, draft, Markdown body — plus SEO overrides |
| **🖼 Images** | Upload JPG/PNG/WebP/GIF (max 4 MB), copy the URL, delete uploads. Repo images are listed too (read-only). |
| **🚀 Publish** | Trigger a rebuild of the live site after saving |
| **👤 Account** | Change your admin password, sign out |

**Slugs (URLs):** a page's URL is its slug — `/blog/<slug>/`, `/projects/<slug>/`, `/<slug>/`. New entries auto-suggest a slug from the title (`My New Post!` → `my-new-post`); you can edit it before the first save. **The slug is locked after saving** (renaming = create a new entry and delete the old one, then update internal links).

**Fallback logic:** if an SEO override is blank, the site uses the entry's normal Title/Description — the site is complete out of the box; overriding is optional.

---

## Part 2 — How content is stored (important concepts)

Three layers, in order of precedence:

1. **Git files in `src/content/`** — the original content, committed to the repository. The build always starts from these.
2. **CMS overrides** — anything you save in `/admin/` is stored in the Durable Object and **replaces** the file version of that entry at build time.
3. **Tombstones** — deleting an entry in the admin stores a "deleted" marker so the git file does **not** come back on the next build.

Notes:

- **Drafts** are built into nothing (no URL, not in sitemap/RSS). Toggle **Draft** to unpublish temporarily.
- **Site settings** work the same way: first save in the admin overrides `src/content/settings/site.yml` forever after.
- **Images uploaded in the admin** live only in Cloudflare storage — they are *not* in git (see Part 9 for backups).
- The **build** reads content from the live site's public export endpoint (`/admin/api/export`, published content only). If that fetch fails (first deploy, offline laptop build), the build silently falls back to the git files.

---

## Part 3 — One-time Cloudflare setup after the first deploy

After this code is merged to `main`, Workers Builds deploys it automatically (the same pipeline that has been deploying the site all along). Then do this **once**:

1. **Create the rebuild hook**
   - Cloudflare dashboard → **Workers & Pages** → **ams-builds-online** → **Settings** → **Builds** → **Deploy Hooks** → **Create** (name: `cms-publish`, branch: `main`) → copy the URL it generates.
2. **Save it as a secret**
   - Still under the Worker → **Settings** → **Variables and Secrets** → **Secret** → name `CMS_DEPLOY_HOOK`, value = the hook URL → Save.
3. **Verify** in the admin: open `/admin/` → **Publish** — the setup box disappears and "Publish now" starts a rebuild (~1 minute).

Until the hook exists, everything else works: saves are stored, and the Publish page shows these exact instructions.

**Storage note:** the first deploy of this code creates the `CmsSite` Durable Object automatically (a migration in `wrangler.jsonc`) — nothing to click for storage. Free plan limits are generous for this site (5 GB storage, 3,000 build minutes/month, 100k Worker requests/day — content pages are served as static assets and do not count against the Worker request limit).

**If a build fails with a Durable Objects permissions error:** the Workers Builds API token needs *Workers Durable Objects → Edit*. Dashboard → **My Profile** → **API Tokens** → the token Workers Builds created → edit permissions → add it → retry the build.

---

## Part 4 — Using the admin day-to-day

### First login

1. Open `https://ams-builds.online/admin/`.
2. The **first username and password you enter become your admin login** (choose something strong — e.g. username `admin` + a long password). Later logins must match exactly.
3. Wrong password too many times → temporary lockout (15 minutes) as brute-force protection.

### Editing

- **Dashboard** — counts, quick actions, publish status, "Unpublished changes" badge.
- **Blog / Pages / Projects** — list with draft/edited badges → **Edit** (or **+ New**).
- The editor shows the **title/description/hero** on the left, the **Markdown body** below, and **details** (dates, tags, flags, SEO) on the right.
- **Save** stores immediately (the badge switches the entry to "edited"). Nothing goes live until you **Publish**.
- **Delete** removes the entry from the next build (confirm dialog first).

### Images

- **Images → + Upload image** (JPG/PNG/WebP/GIF, ≤ 4 MB).
- Copy the URL and paste it into any **media** field (there's a **Choose** button next to media fields that opens the picker).
- Images uploaded here are served from `/images/uploads/<name>` by the Worker.

### Publishing

- Press **Publish now** on the Publish page → Cloudflare rebuilds (~1 minute) → the site updates.
- Last attempt status (time, success/failure, message) is shown right there.
- Free plan hiccup: occasionally Cloudflare refuses a rebuild trigger (build-rate limits). Your content is still saved — press Publish again in a minute.

### Account → Change password

Requires the current password; signs out every other session.

---

## Part 5 — Local development

```bash
npm install
npm run dev        # http://localhost:4321 — admin works, edits stored in .dev-cms/ (gitignored)
npm test           # 23 tests: content build, admin logic, intro overlay
npm run build      # production build → dist/
npx wrangler dev   # run the REAL Worker + Durable Object against dist/ (default port 8787)
```

- **`npm run dev`** renders pages on demand — content edits appear instantly, no rebuild needed. The file-backed `.dev-cms/` store is the dev stand-in for the Durable Object.
- **`npx wrangler dev`** (after a build) is the production-parity check: Durable Object storage, `/admin/`, API, media.
- **`CMS_EXPORT_URL`** (optional env var) points the build's content fetch somewhere else, e.g. `CMS_EXPORT_URL=http://127.0.0.1:8787/admin/api/export npm run build` to build from a local wrangler dev.
- Preview URLs: every pull request gets a Cloudflare preview build automatically (comment on the PR).

---

## Part 6 — First-time checklist inside the admin (do this in order)

1. **⚙️ Site settings:**
   - Replace placeholder phone `+92 300 0000000`, email, address, hours with your real details
   - Paste your **Google Search Console token** (see Part 7) and/or GA4 ID (Part 8) — or leave blank
   - Check the **hero** (badge/title/subtitle/CTA) and **social icons**
   - Save → **Publish**
2. **Pages:** open About/Services/Contact — rewrite in your voice; set nav order (Services 1, About 3, Contact 4), tick Show in Nav/Footer as wanted; SEO overrides optional
3. **Projects:** replace (or edit) the 3 sample case studies with real ones; tick **Featured** for the ones shown on the homepage
4. **Blog:** replace sample posts or keep them as starters; every post supports tags, hero image, SEO overrides
5. Each round: **Save → Publish** → check the live site after ~1 minute.

> Editing tip: upload images via **Images** and use the **Choose** button in editors — no separate file hosting needed.

---

## Part 7 — Google Search Console (discoverability)

**Prerequisite:** the site must be live on its final domain.

1. Go to [search.google.com/search-console](https://search.google.com/search-console) → **Add property**
2. Pick ONE:
   - **Domain property (recommended):** verification = a **DNS TXT record**. Cloudflare Dashboard → your domain → **DNS** → **Records** → add the exact TXT Google shows → wait ~1 min → **Verify**. Nothing to change in the admin. (Covers `ams-builds.online` + subdomains + http/https.)
   - **URL-prefix property** (`https://ams-builds.online/`): verification = **HTML tag**. Copy the token content → admin → **⚙️ Site settings** → paste into **Google site verification tag** → Save → Publish → **Verify**. (The tag is injected site-wide automatically.)
3. **Submit the sitemap:** Search Console → **Sitemaps** → enter `sitemap-index.xml` → **Submit** (robots.txt already references it).
4. **Request indexing** (faster than waiting for crawling): **URL Inspection** → paste each URL → **Request Indexing**: `/`, `/services/`, `/projects/`, `/blog/`, `/contact/`, and any important post.
5. **Ongoing:** check **Pages → Indexing** weekly; new posts submitted via URL Inspection get indexed fastest.
6. **Extras that move the needle for local ranking:**
   - Claim your **Google Business Profile** ("AMS Builds" + services + the *same* phone/address as your site, word-for-word)
   - Import the site into **Bing Webmaster Tools** (one-click GSC import)
   - Share each post on Facebook/LinkedIn/WhatsApp with a backlink

**Realistic expectations:** verification/sitemap = same day; indexing of key pages = days; meaningful impressions/clicks = 2–8 weeks of consistent publishing + backlinks.

---

## Part 8 — Google Analytics 4 (optional) & Google AdSense

### GA4

1. analytics.google.com → Admin → **Create property** → **Web** data stream for `https://ams-builds.online` → copy the **Measurement ID** (`G-XXXXXXXXXX`)
2. Admin → **⚙️ Site settings** → **GA4 measurement ID** → Save → Publish
3. Verify: open the live site → GA4 **Realtime** view should show 1 visitor

### AdSense

**Before applying:** real content (10+ original 800+ word posts — the 4 included posts are a start), working Contact + About + Privacy Policy (already built), and a domain that's at least a few weeks old.

1. Apply at [google.com/adsense](https://www.google.com/adsense) with `ams-builds.online`
2. Once **approved**:
   - Admin → **⚙️ Site settings** → **Enable AdSense = ON**, paste your **Publisher ID** `ca-pub-XXXXXXXXXXXXXXXX` → Save → Publish — the script loads site-wide automatically
   - Replace the placeholder ad-unit slots (`1111111111`…`9999999999`) in these files with your real `data-ad-slot` IDs from AdSense → **Ads** → by ad unit:
     `src/layouts/PageLayout.astro`, `src/layouts/BlogPostLayout.astro`, `src/layouts/ProjectLayout.astro`, `src/pages/blog/index.astro`, `src/pages/index.astro`
   - Create **`public/ads.txt`** containing (AdSense shows you the exact line):
     ```
     google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
     ```
     and commit it — AdSense checks this file.
3. Until enabled, the site shows labeled placeholders — layout and spacing stay identical, so approval review sees a finished page.
4. Policy notes: ads live in `AdSlot` components; `/admin/` is `noindex` and excluded via robots.txt; never click your own ads.

---

## Part 9 — Backups & restore

Your content exists in two places — keep both healthy:

1. **Git (`src/content/`)** — the baseline. It is *not* updated by admin edits; treat it as the original snapshot. Hand-edits here still work (the build merges them with CMS overrides).
2. **The Durable Object** — everything you save in the admin, plus uploaded images.

**What to back up:**

- **Content:** the public export at `https://ams-builds.online/admin/api/export` (JSON: entries + settings, drafts included as metadata). Save it occasionally, e.g.
  ```bash
  curl -s https://ams-builds.online/admin/api/export -o backup-$(date +%F).json
  ```
- **Images:** they are downloadable by URL (`/images/uploads/…`). The admin's Images page lists every path — for a full archive, crawl those URLs (or `wget --mirror` the list).
- **Credentials:** your admin password is hashed (PBKDF2) — it cannot be recovered; use **Account → Change password** instead of trying to extract it.

**Restore:** re-upload images through the admin, then re-create entries (there is no import button in v1 — for large restores, edit the JSON back into the store via the API or ask a developer).

---

## Part 10 — Slugs & per-page SEO control

- **URL = slug.** New entries: slug suggested from the title at creation; locked after save.
- **To change an existing slug:** create a new entry with the new slug, copy the content, delete the old entry, Publish — and update any internal links that pointed at the old URL. (For git-file entries you can also rename the file in the repository.)
- **SEO title / SEO description / OG image / noindex:** every Pages, Projects and Blog entry has an **SEO** section — overrides win over the default title/description; blank = defaults used automatically.
- **noindex** removes a page from search results (keeps it public by URL). To fully unpublish, toggle **Draft** instead — drafts aren't built at all.

---

## Part 11 — Content strategy for AdSense approval

1. Publish 10–15 original posts (800–1,500 words): pricing guides, local SEO, case studies — the included 4 articles are templates/examples
2. Upload real images (compressed < 500 KB) via the admin; 1–2 per post + descriptive alt text
3. Never copy other sites; keep a consistent publishing cadence (even 1 post/week)
4. Get the site a few backlinks: Google Business Profile, social profiles, local directories
5. Approval timing: typically days to a few weeks for a clean, original site on a real domain

---

## Part 12 — Where the code lives / how to customize it

```
src/
├── content/schemas.mjs       # ← content model (add fields here + in src/lib/fields.mjs)
├── content/settings/site.yml # ← Site Settings defaults (overridden by the admin)
├── content/pages|projects|blog/  # baseline content (overridden/deleted by the admin)
├── lib/content-source.mjs    # build-time content (files + CMS overrides)
├── lib/fields.mjs            # admin form fields + save-time validation
├── lib/admin-client.js       # admin SPA (vanilla JS)
├── pages/admin.astro         # admin shell
├── pages/admin/api/          # admin REST API
├── utils/site.ts             # getSite() helper used everywhere
├── components/…              # SEO, Header, Footer, AdSlot, cards, Breadcrumbs
├── layouts/…                 # BaseLayout (GA4/AdSense), Page/BlogPost/Project
└── styles/global.css         # Tailwind + prose typography
worker/cms-do.js              # Durable Object (entries, images, auth, sessions)
worker/main.js                # Worker entry (Astro app + DO class)
wrangler.jsonc                # Worker, assets, DO binding, preview isolation
tailwind.config.mjs           # colors (amber brand, slate) & fonts
```

Common tweaks:

- **Brand color:** swap `amber` for another Tailwind palette in `tailwind.config.mjs` + the `*-amber-*` classes
- **Add a fixed nav item:** edit `fixedLinks` in `Header.astro` (CMS pages manage themselves)
- **New content field:** add it in `src/content/schemas.mjs` **and** `src/lib/fields.mjs` **and** the layout that displays it
- **Local preview of production build:** `npm run build && npx wrangler dev`

---

## Part 13 — Troubleshooting

| Symptom | Cause → Fix |
|---|---|
| `/admin` shows the login but sign-in fails | First login *sets* the credentials — use exactly what you typed the first time. Locked out? Wait 15 minutes (30 failed attempts), or as a last resort wipe the local/remote auth (see below) |
| "Publish" says the hook is not configured | Part 3 — create the Deploy Hook + `CMS_DEPLOY_HOOK` secret |
| Publish says "Cloudflare refused the rebuild trigger" | Free-plan build rate limit → wait a minute and retry; content is already saved |
| Saved content not on the live site | You saved but didn't **Publish**? Publish → wait for the rebuild (~1 min). Check the Worker's build history for failures |
| Build failed after a save | Usually invalid frontmatter (the admin validates before saving, so this is rare — hand-edited git files are the usual suspect). Cloudflare → Worker → Builds → open the failed build log |
| Preview (PR) URL shows old content | Previews build from git + the *production* content export — that's expected; CMS edits appear after Publish + merge |
| Image broken after upload | Only JPG/PNG/WebP/GIF ≤ 4 MB are allowed; check the URL in the Images page |
| Need to reset the admin password (last resort) | Delete the password record: dashboard → Worker → **Settings → Durable Objects** is not enough — easiest is a tiny `wrangler` script calling `CMS.getByName('site')`, or ask a developer; the next login then re-bootstraps credentials |
| Sitemap 404 in Search Console | Deploy finished before sitemap existed → re-build/redeploy; `dist/sitemap-index.xml` must exist |
| GSC token set but tag missing | Site settings → Save → Publish → view-source on the homepage and search `google-site-verification` |
| Ads not rendering | Enable toggle ON? correct `ca-pub-`? slot IDs replaced? account approved? `ads.txt` uploaded? |
| Mobile menu broken | `global.css` lost the `.menu-icon-*` rules — revert `src/styles/global.css` |

---

## Part 14 — Launch checklist

- [ ] Deploy Hook created + `CMS_DEPLOY_HOOK` secret saved (Part 3)
- [ ] `Site settings` filled with real phone / WhatsApp / email / address / hours
- [ ] Sample projects replaced with real case studies; homepage stats set honestly
- [ ] About / Services / Contact reviewed and rewritten
- [ ] At least one real blog post published (or the samples rewritten)
- [ ] Domain live on HTTPS (`https://ams-builds.online`) — check padlock icon
- [ ] `/admin/` login works with username/password (credentials chosen by you)
- [ ] Search Console verified + sitemap submitted + key URLs requested for indexing
- [ ] Bing Webmaster imported; Google Business Profile claimed (NAP matches site)
- [ ] Email routing for `hello@ams-builds.online` working
- [ ] `Privacy Policy` / `Terms` reviewed for your business
- [ ] `public/ads.txt` created (after AdSense approval)
- [ ] First backup of `/admin/api/export` downloaded (Part 9)

You now have a production site where **every meaningful word, contact detail, SEO tag and ad is editable from `/admin/`** — no developer, no GitHub account, no third-party CMS needed for day-to-day changes. Only structural/design changes (layout, styling, new field types) require editing code.
