# AMS Builds — Complete Guide
**Deployment to Vercel + 100% CMS-managed site**

This guide takes you from the zip file to a live, Google-indexed, AdSense-ready website at **https://ams-builds.online** — and shows you how to manage **everything** (brand, contact, hero, SEO slugs/titles/descriptions, Google Search Console tag, analytics, ads, navigation) from the CMS at `https://ams-builds.online/admin/`.

> **How the system works (30 seconds)**
> There is no database. The CMS commits content changes to your GitHub repository. Vercel notices the commit, rebuilds the site, and the live site updates. A small serverless function handles GitHub sign-in; it does not store content.
>
> **You edit in /admin → commit to GitHub → Vercel auto-builds → live site updated**

---

## Part 1 — What exactly can I manage from the CMS?

Everything below is editable at `https://ams-builds.online/admin/`:

| CMS Section | What you control |
|---|---|
| **⚙️ Site Settings** (singleton) | Site name, tagline, logo text/initial, short description, phone, WhatsApp, email, address, opening hours, price range, social links (Facebook/Instagram/LinkedIn/YouTube/GitHub/X), **Google Search Console verification token**, **GA4 measurement ID**, **AdSense enable + publisher ID**, homepage hero (badge, H1, subtitle, CTA text/link, hero image), default social-share (OG) image, stats row ("50+ Projects…") |
| **Pages** | About / Services / Contact / Privacy / Terms — title, SEO description, hero title/subtitle, featured image, nav order, show in nav / show in footer, draft, plus per-page SEO overrides (SEO title, SEO description, OG image, noindex) |
| **Projects** | Case studies — title, description, client, category (web/android/software/ecommerce), technologies, cover image, featured-on-homepage flag, date, results, live URL, body — plus SEO overrides |
| **Blog** | Articles — title, description, publish/updated dates, author, tags, hero image, featured flag, draft, body — plus SEO overrides |

**Slugs (URLs):** A page's URL is its filename, e.g. `src/content/pages/services.md` → `/services/`. When you create an entry in the CMS, Decap generates the slug from the title (lowercase, accents removed, hyphens: `My New Post!` → `my-new-post`). To change an existing slug, rename the file in GitHub (or locally) and push — see Part 10.

**Fallback logic:** If an SEO override is blank, the CMS uses the entry's normal Title/Description — so the site is complete out of the box; overriding is optional.

---

## Part 2 — Prerequisites

1. **Node.js 20+** (you have it if `npm -v` ≥ 9)
2. A **GitHub account** (free)
3. A **Vercel account** with access to the GitHub repository; access to the domain's DNS settings to point `ams-builds.online` at Vercel
4. About 45–60 minutes for first-time setup

---

## Part 3 — Confirm the GitHub repository

This site is maintained in [`rizwanahmedsora9-pixel/ams-builds.online`](https://github.com/rizwanahmedsora9-pixel/ams-builds.online). Clone it locally only if you need to edit files outside the CMS:

```bash
git clone https://github.com/rizwanahmedsora9-pixel/ams-builds.online.git
cd ams-builds.online
npm install
npm test
npm run build
```

CMS entries are stored as Markdown/YAML in `src/content/`. Published changes commit to the repository's `main` branch.

---

## Part 4 — Deploy to Vercel

1. In Vercel, choose **Add New → Project** and import `rizwanahmedsora9-pixel/ams-builds.online` from GitHub.
2. Use the Astro framework preset and confirm:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |
| Root directory | `/` (repository root) |
| Node.js version | `20.x` or newer |

3. Deploy. Vercel serves the generated static site and deploys the small `/api` OAuth functions; `vercel.json` maps Decap's `/auth` and `/callback` endpoints to those functions.
4. Add `ams-builds.online` under **Project → Settings → Domains**, and configure the DNS records Vercel shows. Use the apex domain as the canonical CMS origin unless you intentionally change `CMS_PUBLIC_URL` and the Decap config.

> The Vercel project must be connected to this GitHub repository for CMS-published commits on `main` to trigger a rebuild. CMS OAuth setup is in Part 5.

---

## Part 5 — Enable the CMS at /admin (GitHub OAuth)

The admin UI is a static Decap CMS page at `/admin/`. Its GitHub backend uses the Vercel OAuth functions in `/api`; no third-party OAuth proxy is needed. The CMS is pointed at `rizwanahmedsora9-pixel/ams-builds.online`, branch `main`.

**A1. Create a GitHub OAuth App**
1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set **Application name** to `AMS Builds CMS`, **Homepage URL** to `https://ams-builds.online`, and **Authorization callback URL** to exactly `https://ams-builds.online/callback`.
3. Register it, copy the Client ID, then generate and copy a Client Secret. Keep the secret private.

**A2. Add credentials to Vercel**
In the Vercel project for this site, open **Settings → Environment Variables** and add these for **Production** and **Preview**:

| Variable | Value |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | OAuth App Client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | OAuth App Client Secret (mark as sensitive/encrypted) |
| `CMS_PUBLIC_URL` | `https://ams-builds.online` |

`CMS_PUBLIC_URL` must match the domain where the CMS is opened and the OAuth App callback URL. `GITHUB_OAUTH_SCOPE` is optional; the default `public_repo` is appropriate for this public repository. If the repo is private, set it to `repo`. Redeploy after adding or changing variables.

**A3. Sign in and verify**
Open `https://ams-builds.online/admin/`, choose **Login with GitHub**, and authorize the OAuth App. Create a draft entry and publish it; verify the new commit reaches `main` and Vercel starts a fresh build. The code under `api/` exchanges the one-time GitHub authorization code server-side, keeps the client secret out of the browser, validates OAuth state, and returns the token to the CMS popup.

### Local editing without OAuth

For local-only editing, uncomment `local_backend: true` in `public/admin/config.yml`, then run `npm run dev` and `npx decap-server` in separate terminals. Open `http://localhost:4321/admin/`. Edits write into the local repository; push them to `main` to deploy. Do not leave local backend enabled in production.

**Troubleshooting**
- 404 at `/admin/`: check the production deployment includes `dist/admin/index.html` and Vercel's output directory is `dist`.
- `CMS GitHub OAuth is not configured`: add the three Vercel variables above and redeploy.
- OAuth callback/state error: callback must be exactly `https://ams-builds.online/callback`; open the CMS at the same canonical domain, not a Vercel preview URL.
- Login works but repository access fails: confirm repo/branch in `public/admin/config.yml`; for a private repo, set the OAuth scope to `repo` and authorize again.

---

## Part 6 — First-time checklist inside the CMS (do this in order)

1. **⚙️ Site Settings:**
   - Replace placeholder phone `+92 300 0000000`, email, address, hours with your real details
   - Paste your **Google Search Console token** (see Part 7) and/or GA4 ID (Part 8) — or leave blank
   - Check the **hero** (badge/title/subtitle/CTA) and **social icons**
   - Save → in **editorial workflow** (this site uses it) entries go *Draft → In Review → Ready → Published*; move to **Published** to commit to `main`
2. **Pages:** open About/Services/Contact — rewrite in your voice; set nav order (Services 1, About 3, Contact 4), tick Show in Nav/Footer as wanted; SEO overrides optional
3. **Projects:** replace (or edit) the 3 sample case studies with real ones; tick **Featured** for the ones shown on the homepage
4. **Blog:** replace sample posts or keep them as starters; every post supports tags, hero image, SEO overrides
5. Each **Publish** → commit to GitHub → Vercel rebuild. Check the live site after the deployment is ready.

> Editing tip: images upload via the media library into `public/images/uploads/` and are committed with your content — no separate file hosting needed.

---

## Part 7 — Google Search Console (discoverability) — via the CMS

**Prerequisite:** the site must be live on its final domain.

1. Go to [search.google.com/search-console](https://search.google.com/search-console) → **Add property**
2. Pick ONE:
   - **Domain property (recommended):** verification = a **DNS TXT record**. Cloudflare Dashboard → your domain → **DNS** → **Records** → add the exact TXT Google shows → wait ~1 min → **Verify**. Nothing to change in the CMS. (Covers `ams-builds.online` + subdomains + http/https.)
   - **URL-prefix property** (`https://ams-builds.online/`): verification = **HTML tag**. Copy the token content → CMS → **⚙️ Site Settings** → paste into **Google Site Verification Token** → **Publish** → wait for redeploy → **Verify**. (The tag is injected site-wide automatically — already wired into `SEO.astro`.)
3. **Submit the sitemap:** Search Console → **Sitemaps** → enter `sitemap-index.xml` → **Submit** (robots.txt already references it; it lists every page, project and post). Expect status "Success".
4. **Request indexing** (faster than waiting for crawling): **URL Inspection** bar → paste each URL → **Request Indexing**: `/`, `/services/`, `/projects/`, `/blog/`, `/contact/`, and any important post.
5. **Ongoing:** check **Pages → Indexing** weekly; enable email alerts; new posts submitted via URL Inspection get indexed fastest.
6. **Extras that move the needle for local ranking:**
   - Claim your **Google Business Profile** ("AMS Builds" + services + the *same* phone/address as your site, word-for-word)
   - Import the site into **Bing Webmaster Tools** (one-click GSC import)
   - Share each post on Facebook/LinkedIn/WhatsApp with a backlink

**Realistic expectations:** verification/sitemap = same day; indexing of key pages = days; meaningful impressions/clicks = 2–8 weeks of consistent publishing + backlinks.

---

## Part 8 — Google Analytics 4 — via the CMS (optional)

1. analytics.google.com → Admin → **Create property** → add a **Web** data stream for `https://ams-builds.online` → copy the **Measurement ID** (`G-XXXXXXXXXX`)
2. CMS → **⚙️ Site Settings** → **GA4 Measurement ID** → Publish
3. Verify: open the live site → GA4 **Realtime** view should show 1 visitor

---

## Part 9 — Google AdSense — via the CMS

**Before applying:** ensure real content (10+ original 800+ word posts — the 4 included posts are a start; publish more), working Contact + About + Privacy Policy (already built), and a domain that's at least a few weeks old.

1. Apply at [google.com/adsense](https://www.google.com/adsense) with `ams-builds.online`
2. Once **approved**:
   - CMS → **⚙️ Site Settings** → **Enable AdSense = ON**, paste your **Publisher ID** `ca-pub-XXXXXXXXXXXXXXXX` → **Publish** → the AdSense script loads site-wide automatically
   - Replace the placeholder ad-unit slots (`1111111111`…`9999999999`) in these files with your real `data-ad-slot` IDs from AdSense → **Ads** → by ad unit:
     `src/layouts/PageLayout.astro`, `src/layouts/BlogPostLayout.astro`, `src/layouts/ProjectLayout.astro`, `src/pages/blog/index.astro`, `src/pages/index.astro`
   - Create **`public/ads.txt`** containing (AdSense shows you the exact line):
     ```
     google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
     ```
     and push it — AdSense checks this file.
3. Until enabled, the site shows labeled placeholders — layout and spacing stay identical, so approval review sees a finished page.
4. Policy notes: ads live in `AdSlot` components (blog top/in-article/sidebar, pages, homepage); `/admin/` is `noindex` and excluded via robots.txt; never click your own ads.

---

## Part 10 — Slugs & per-page SEO control

- **URL = filename.** New entries: slug is derived from the title at creation (`Best SEO Tips!` → `/blog/best-seo-tips/`).
- **Change a slug later:** rename the file in GitHub (e.g. `src/content/blog/best-seo-tips.md` → `src/content/blog/10-local-seo-tips.md`) and commit. Vercel rebuilds; update any internal links. (GitHub web UI → the file → ⋯ → Rename → commit.)
  - To keep the old URL alive, add a permanent redirect to `vercel.json` (Vercel reads it):
    ```json
    { "source": "/blog/old-slug", "destination": "/blog/new-slug", "permanent": true }
    ```
    Add that object to the existing `redirects` array in `vercel.json`.
- **SEO title / SEO description / OG image / noindex:** every Pages, Projects and Blog entry has an **SEO** section — overrides win over the default title/description; blank = defaults used automatically.
- **noindex** removes a page from search results (keeps it public by URL). To fully hide and remove a page: toggle **Draft = true** instead — drafts aren't built at all. Note: noindexed pages can still appear in the sitemap (it lists everything built); drafts/exclusions are the clean way to unpublish.

---

## Part 11 — Content strategy for AdSense approval

1. Publish 10–15 original posts (800–1,500 words): pricing guides, local SEO, case studies — the included 4 articles are templates/examples
2. Upload real images (compressed < 500 KB) via the media library; 1–2 per post + descriptive alt text
3. Never copy other sites; keep a consistent publishing cadence (even 1 post/week)
4. Get the site a few backlinks: Google Business Profile, social profiles, local directories (e.g. `Pak Wheels` business listings, Facebook page)
5. Approval timing: typically days to a few weeks for a clean, original site on a real domain

---

## Part 12 — Where the code lives / how to customize it

```
src/
├── content/settings/site.yml   # ← CMS "Site Settings" (brand, contacts, Google tags)
├── content/pages/              # ← CMS Pages (about.md, services.md, ...)
├── content/projects/           # ← CMS Projects
├── content/blog/               # ← CMS Blog
├── content/config.ts           #   content schemas (add fields here)
├── utils/site.ts               #   getSite() helper used everywhere
├── components/SEO.astro        #   meta/OG/JSON-LD (driven by settings)
├── components/Header.astro     #   nav: fixed + dynamic CMS pages (navOrder)
├── components/Footer.astro     #   dynamic footer + settings contact/socials
├── components/AdSlot.astro     #   AdSense units (render real ads when enabled)
├── layouts/…                   #   BaseLayout (GA4/AdSense), Page/BlogPost/Project layouts
├── pages/index.astro           #   homepage (hero/stats from Site Settings)
└── styles/global.css           #   Tailwind + prose typography
tailwind.config.mjs             #   colors (amber brand, slate) & fonts
```

Common tweaks:
- **Brand color:** swap `amber` for another Tailwind palette in `tailwind.config.mjs` + the `*-amber-*` classes
- **Add a fixed nav item:** edit `fixedLinks` in `Header.astro` (CMS pages manage themselves)
- **New content field:** add it in `config.ts` schema **and** `admin/config.yml` **and** the layout
- **Local preview of production build:** `npm run build && npm run preview -- --host 0.0.0.0` (or serve `dist/` statically)

---

## Part 13 — Troubleshooting

| Symptom | Cause → Fix |
|---|---|
| `/admin` blank page or endless loader | Check the browser console, confirm `config.yml` has the correct backend URL, then verify the Vercel deployment includes the `/api` OAuth functions |
| Login OK, but "repo not found" | `repo:` typo, or OAuth app lacks repo access → revoke app at github.com/settings/applications, re-login; verify `owner/repo` exactly |
| Published content not on live site | Wait for the Vercel deployment to finish; hard-refresh; if the build **failed**, inspect its logs (often a YAML/frontmatter typo — fix quotes/colons) |
| Sitemap 404 in Search Console | Deploy finished before sitemap existed → re-build/redeploy; `dist/sitemap-index.xml` must exist |
| GSC token set but tag missing | Rebuild happened? Token in Site Settings → Publish → check Deployments log → view-source on the live homepage and search `google-site-verification` |
| Ads not rendering | Enable toggle ON? correct `ca-pub-`? slot IDs replaced? account approved? `ads.txt` uploaded? |
| Build fails after CMS edit | Frontmatter invalid (unquoted `:` in a title, bad date) → the CMS usually quotes strings, but fix the file in GitHub to restore the build |
| Mobile menu broken | `global.css` lost the `.menu-icon-*` rules — revert `src/styles/global.css` |

---

## Part 14 — Launch checklist

- [ ] `Site Settings` filled with real phone / WhatsApp / email / address / hours
- [ ] Sample projects replaced with real case studies; homepage stats set honestly
- [ ] About / Services / Contact reviewed and rewritten
- [ ] At least one real blog post published (or the samples rewritten)
- [ ] Domain live on HTTPS (`https://ams-builds.online`) — check padlock icon
- [ ] `/admin/` login works with GitHub
- [ ] Search Console verified + sitemap submitted + key URLs requested for indexing
- [ ] Bing Webmaster imported; Google Business Profile claimed (NAP matches site)
- [ ] Email routing for `hello@ams-builds.online` working
- [ ] `Privacy Policy` / `Terms` reviewed for your business
- [ ] `public/ads.txt` created (after AdSense approval)

You now have a production site where **every meaningful word, contact detail, SEO tag and ad is editable from the CMS** — no developer needed for day-to-day changes. Only structural/design changes (layout, styling, new field types) require editing code.
