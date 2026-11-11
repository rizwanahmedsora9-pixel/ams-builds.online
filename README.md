# AMS Builds — Web & App Development

**Astro 4 + Tailwind CSS + a shared CMS at `/admin/`, running on Cloudflare Workers.**

The public website is rendered on demand. Saving a page, post, project, image, or site setting in the admin makes it available to every visitor on the next request—there is no Publish button, rebuild, deploy hook, or browser-local content store.

## Features

- **Shared publishing:** content, settings, and uploaded images live in one SQLite-backed `CmsSite` Durable Object.
- **Repository baseline:** the original Markdown, YAML, and images in Git remain available and are merged with CMS changes. CMS edits override matching files; deletion markers keep deleted file entries deleted after redeploys.
- **Real public URLs:** new pages, blog posts, and projects return normal HTTP 200 HTML, including from fresh browsers and anonymous requests.
- **Admin CMS:** create/edit/delete blog posts, pages, and projects; manage drafts, navigation, SEO fields, and site settings; preview Markdown; upload and select images.
- **Immediate listings and feeds:** homepage, header/footer navigation, blog/project indexes, RSS, and sitemap use current shared content.
- **Server authentication:** PBKDF2 password hashes, HTTP-only session cookies, same-origin mutation guards, and login rate limiting.
- **Worker-safe Markdown:** rendered and sanitized on the server without request-time WebAssembly.
- **SEO and design retained:** metadata, Open Graph, JSON-LD, responsive layouts, intro experience, and optional analytics/AdSense.

## First sign-in

Open `/admin/` and use:

- **Username:** `admin`
- **Password:** `admin12345`

**Change this password immediately under Admin → Account.** A fresh CMS accepts only these documented initial credentials; an anonymous visitor cannot choose the first admin account. Credentials and sessions are stored in shared storage, not in the browser's local storage.

## Local development

```bash
npm install
npm run dev       # Astro development server on port 4321
```

Development uses the same admin APIs and public request-time rendering with a file-backed store in `.dev-cms/`. That directory is ignored by Git.

To exercise the actual production Worker and Durable Object locally:

```bash
npm run preview   # production build + Wrangler on port 4321
```

Or, after a build, choose another port:

```bash
npx wrangler dev --local --host 0.0.0.0 --port 4322
```

## Tests

```bash
npm test
npm run build
```

The suite includes unit/schema/security checks plus an isolated production-stack regression. The latter builds a temporary copy, starts Wrangler, rejects a first-login takeover, saves content/settings and a real JPEG, verifies anonymous HTML/listings/feeds/sitemap/media bytes and refresh persistence, and removes its temporary content. Browser verification should additionally use independent incognito contexts; a same-browser DOM preview is not accepted as publishing proof.

## Cloudflare deployment

A static-only host is **not sufficient**: `/admin/` and public content need the Worker and Durable Object.

1. Authenticate Wrangler in your own Cloudflare environment (`npx wrangler login`, or configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your deployment environment). Never put credentials in Git.
2. Build and deploy:

   ```bash
   npm run build
   npx wrangler deploy
   ```

3. Connect `ams-builds.online` and `www.ams-builds.online` as Custom Domains for the `ams-builds-online` Worker in Cloudflare.
4. Sign in at the deployed `/admin/`, change the initial password, and verify a test page from a fresh/incognito browser.

`wrangler.jsonc` declares the `CMS` binding and SQLite migration. No application secrets or environment variables are required. Do not delete or rename the deployed Durable Object: it holds the live edits independently of Git deployments.

See **[GUIDE.md](./GUIDE.md)** for content editing, media, backups, architecture, and deployment verification.

## Important paths

```text
src/pages/admin.astro            # authenticated admin shell
src/pages/admin/api/             # session, CRUD, settings, media, status, export APIs
src/lib/admin-client.js          # admin interface
src/lib/content-source.mjs       # request-local repository + shared-store merge
src/lib/store.mjs                # production Durable Object / development store selector
src/lib/dev-store.mjs            # local file-backed development store
worker/main.js                   # Worker entry
worker/cms-do.js                 # shared SQLite Durable Object
src/content/                     # Git-tracked baseline content
src/pages/images/uploads/        # uploaded-media request handler
tests/cms-content.test.mjs       # isolated production publishing regression
wrangler.jsonc                   # Worker, assets, CMS binding and migration
```
