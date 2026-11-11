# Edge CMS

A WordPress-style CMS that runs as one Cloudflare Worker (TypeScript + Hono) serving the public site and the admin panel, with D1 for data and KV for uploaded media, the install lock, config and page cache. No R2 and no payment card are needed. The same code also runs on plain Node.js with a SQLite file and a media folder, so it works on any VPS, in Docker or on your own computer.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Installer, login, dashboard, pages, posts (categories, tags, featured image, scheduling), media, settings, default theme, page cache | **done** |
| 2 | Menus and theme upload | **done** |
| 2 | Custom code UI, users and roles UI, redirects, sitemap.xml, robots.txt, RSS | next |
| 3 | Backups, plugin hooks, multi-site | later |

The full database schema for all three phases is already created at install.

## Where it runs

The same code runs in two ways. Pick whichever fits; the installer, admin panel and themes are identical.

| | Cloudflare Workers | Node.js (VPS, Docker, PaaS, your PC) |
| --- | --- | --- |
| Database | D1 | SQLite file in `data/cms.sqlite` |
| Media | KV (max 20 MB per file) | files in `data/media/` |
| Config and cache | KV | table in the same SQLite file |
| Scheduled publishing | Cron Trigger (every 5 min) | built-in timer (every minute) |
| Start | `npx wrangler deploy` | `npm start` |

## Option A: Cloudflare

Needs a Cloudflare account. The free plan works and no payment card is needed.

**No terminal (works from a phone):** make the GitHub repository public, then open

```
https://deploy.workers.cloudflare.com/?url=https://github.com/rizwanahmedsora9-pixel/ams-builds.online
```

or go to **Workers & Pages → Create → Import a repository**. Cloudflare creates the database and KV namespace, deploys, and redeploys on every push.

**From a PC** (Node.js 22+):

```bash
git clone https://github.com/rizwanahmedsora9-pixel/ams-builds.online.git
cd ams-builds.online
npm install
npx wrangler login
npx wrangler deploy
```

`wrangler.toml` has no resource IDs on purpose: the first deploy creates the D1 database and KV namespace and later deploys reuse them. If your wrangler refuses to do that, create them yourself (`npx wrangler d1 create edge_cms`, `npx wrangler kv namespace create KV`) and add `database_id = "..."` and `id = "..."` to the matching blocks.

Open the `*.workers.dev` URL wrangler prints and finish the installer. To use your own domain, add it under **Workers & Pages → your worker → Settings → Domains & Routes**.

**From Termux:** wrangler's local runtime has no Android build, so run it inside an Ubuntu container:

```bash
pkg update && pkg install proot-distro
proot-distro install ubuntu && proot-distro login ubuntu
apt update && apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
git clone https://github.com/rizwanahmedsora9-pixel/ams-builds.online.git
cd ams-builds.online && npm install
export CLOUDFLARE_API_TOKEN=your-token   # dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template, plus D1: Edit
npx wrangler deploy
```

## Option B: any server or your own computer

Needs Node.js 22.13 or newer. Nothing else: no database server, no PHP, no native modules.

```bash
git clone https://github.com/rizwanahmedsora9-pixel/ams-builds.online.git
cd ams-builds.online
npm install
npm start                # http://localhost:8787
```

Everything the site stores lives in `data/`. Back up that folder and you have backed up the site.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | port to listen on |
| `HOST` | `0.0.0.0` | address to bind |
| `DATA_DIR` | `./data` | database and uploads |
| `TRUST_PROXY` | off | set to `1` behind nginx, Caddy or a PaaS router, so HTTPS, the real hostname and visitor IPs are detected. Leave off when the port is exposed directly. |

**Docker:**

```bash
docker compose up -d     # http://localhost:8787, data in the cms-data volume
```

**Behind a reverse proxy** (gives you HTTPS). Caddy needs two lines:

```
example.com {
    reverse_proxy localhost:8787
}
```

and start the CMS with `TRUST_PROXY=1 npm start`. For nginx, forward `Host`, `X-Forwarded-Proto` and `X-Forwarded-For`.

**Keep it running on a VPS:** `npm run build` once, then run `node dist/server.mjs` under systemd or pm2. `dist/server.mjs` is a single self-contained file.

**Platforms like Render, Railway or Fly:** build command `npm install && npm run build`, start command `node dist/server.mjs`, `TRUST_PROXY=1`, and a persistent disk mounted at `DATA_DIR`. Without a persistent disk the site resets on every deploy.

**Termux, directly on the phone:** `pkg install nodejs git`, then the same four commands. The Cloudflare tooling is an optional dependency, so `npm install` is meant to skip it on Android instead of failing. This path has not been run on a real phone yet; if `npm install` fails, use the Ubuntu container from Option A.

Static-only hosts (GitHub Pages, shared PHP hosting) cannot run it. Vercel and Netlify functions have no persistent disk, so they are not supported.

## Development

```bash
npm run dev          # Cloudflare runtime locally (state in .wrangler/)
npm start            # Node runtime (state in data/)
npm run typecheck
```

Delete `.wrangler/` or `data/` to start again from the installer.

## Tests

```bash
npm test                  # end-to-end on the Node.js runtime
npm run test:cloudflare   # the same steps on the Cloudflare runtime (wrangler dev)
npm run test:all
```

Each run starts a real server on an empty temporary data folder and drives it over HTTP: health check, installer (bad input, success, lock), public site and cache, login and CSRF, pages, media, posts, drafts and scheduling, settings, password change, restart, deletion, logout and rate limiting. It prints one line per step and removes the folder afterwards.

`GET /api/health` reports the runtime, whether the site is installed, and whether the database, key-value store and media storage answer. Use it for uptime monitoring.

## Menus

- Tick **Show in the main menu** when editing a page and it is linked in the site header once published. New pages start ticked.
- **Menus** in the admin panel lets you reorder links (drag the handle or use the arrows), rename them, add custom links, and create a footer menu.

## Themes

**Themes** in the admin panel lists installed themes and lets an admin upload, activate, download and delete them. Download the Default theme to get a working file to edit.

A theme is one JSON file:

```json
{
  "name": "My Theme",
  "version": "1.0.0",
  "templates": { "base": "...{{{content}}}...", "home": "...", "page": "...", "post": "...", "archive": "...", "404": "..." },
  "css": "body { ... }"
}
```

Only `base` is required and it must contain `{{{content}}}`; missing templates fall back to the Default theme. A `.zip` also works: put `theme.json` next to `base.html`, `home.html`, `page.html`, `post.html`, `archive.html`, `404.html` and `style.css` (the layout of `src/themes/default/`).

Template tags: `{{value}}` (escaped), `{{{value}}}` (raw HTML), `{{#if x}}…{{else}}…{{/if}}`, `{{#unless x}}…{{/unless}}`, `{{#each list}}…{{/each}}`.

| Available in | Values |
| --- | --- |
| every template | `site.title`, `site.tagline`, `site.url`, `year`, `body_class`, `menu.primary` and `menu.footer` (lists of `label`, `url`, `active`) |
| `base` only | `{{{head}}}` (title, SEO tags, custom code), `{{{theme_css}}}`, `{{{content}}}`, `{{{footer}}}` |
| `home` | `page` (the chosen home page, may be empty), `posts` (latest five) |
| `page` | `page.title`, `{{{page.content}}}` |
| `post` | `post.title`, `{{{post.content}}}`, `post.date`, `post.date_iso`, `post.author`, `post.featured_image`, `post.featured_alt`, `post.categories` and `post.tags` (lists of `name`, `url`) |
| `archive` | `archive.title`, `posts`, `pagination.prev`, `pagination.next` |
| each item of `posts` | `title`, `url`, `excerpt`, `date`, `date_iso`, `featured_image`, `featured_alt` |

A theme can contain scripts, so only install themes you trust.

## How it works

- **Install lock** – KV key `installed`. Without it every request redirects to `/install`; with it `/install` is a 404. The installer also checks D1 for an existing user, so it cannot run twice while KV is still propagating.
- **Admin URL** – the slug lives in the KV `config` key and can be changed in Settings. The admin panel is not linked from the public site.
- **Security** – PBKDF2-SHA256 passwords (100,000 iterations, the Workers maximum), HMAC-signed session cookies that are invalidated by a password change, CSRF tokens plus an Origin check on every POST, and 5 failed logins per IP per 15 minutes.
- **Content** – admins save raw HTML. Editors and authors go through an allow-list sanitizer (`src/lib/security.ts`). Authors can only edit their own posts.
- **Themes** – a theme is a set of templates (`base`, `home`, `page`, `post`, `archive`, `404`) plus CSS, stored in D1. Template syntax: `{{var}}` (escaped), `{{{var}}}` (raw), `{{#if x}}…{{else}}…{{/if}}`, `{{#unless x}}`, `{{#each list}}`.
- **Page cache** – rendered pages are stored in KV for 24 hours under a key that includes a generation number. Any edit bumps the number, which invalidates everything. Signed-in users bypass the cache. KV is eventually consistent, so visitors in other regions can see a stale page for up to a minute.
- **Scheduling** – a Cron Trigger runs every 5 minutes and publishes due posts. Due posts are also visible on uncached pages as soon as their time passes.
- **Multi-domain** – the Worker answers on any hostname routed to it and builds URLs from the `Host` header. Every content table has a `site_id` column (default 1) and there is a `sites` table keyed by hostname, ready for multi-site.
- **JSON API** – `GET /api/posts`, `/api/posts/:slug`, `/api/pages/:slug` (published content only).

## Free-plan limits worth knowing

On Cloudflare, KV allows 1,000 writes a day and 1 GB of storage on the free plan, and uploaded media counts towards both. Host videos elsewhere (for example YouTube) and embed them. Each first view of a page after an edit costs one write, as does each edit and each failed login. A small site stays well inside this; a busy one should move to the paid plan.

## File tree

```
wrangler.toml
Dockerfile, docker-compose.yml
tests/e2e.mjs              end-to-end tests for both runtimes
src/
  index.ts                 install gate, admin/public dispatch, cron handler
  types.ts
  routes/
    install.ts             first-run wizard
    public.ts              themed site, /media/*, KV page cache
    api.ts                 read-only JSON API
    admin/
      index.ts             CSRF, login, logout, dashboard, profile
      content.ts           pages and posts
      media.ts             media library
      settings.ts
      menus.ts               menu editor
      themes.ts              theme upload, activate, delete
  node/
    server.ts              Node.js entry point (PORT, DATA_DIR, TRUST_PROXY)
    storage.ts             SQLite + disk versions of D1, KV and file storage
  db/
    schema.sql
    index.ts               schema runner
    migrations/index.ts    forward-only migrations
  lib/
    auth.ts                passwords, sessions, CSRF, roles
    security.ts            escaping, sanitizer, rate limiting
    files.ts               uploaded files: KV on Cloudflare, disk on Node
    themes.ts, zip.ts      theme bundle reader (JSON or zip)
    menus.ts               page-to-menu sync
    render.ts              template engine, theme rendering
    content.ts             content queries, permalinks
    config.ts              KV config, settings
    time.ts                timezone helpers
    ui.ts                  admin HTML helpers and CSS
  themes/default/          theme.json, templates, style.css
```
