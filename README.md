# Edge CMS

A WordPress-style CMS that runs entirely on Cloudflare: one Worker (TypeScript + Hono) serves the public site and the admin panel, with D1 for data, R2 for media and KV for the install lock, config and page cache. The only runtime dependency is Hono.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Installer, login, dashboard, pages, posts (categories, tags, featured image, scheduling), media, settings, default theme, page cache | **done** |
| 2 | Menus, theme upload, custom code UI, users and roles UI, redirects, sitemap.xml, robots.txt, RSS | next |
| 3 | Backups to R2, plugin hooks, multi-site | later |

The full database schema for all three phases is already created at install.

## Deploy from a PC

Needs Node.js 20+ and a Cloudflare account (the free plan works; R2 has to be enabled once in the dashboard).

```bash
git clone https://github.com/rizwanahmedsora9-pixel/ams-builds.online.git
cd ams-builds.online
npm install
npx wrangler login

npx wrangler d1 create edge_cms            # prints database_id
npx wrangler kv namespace create KV        # prints id
npx wrangler r2 bucket create edge-cms-media
```

Paste the two IDs into `wrangler.toml` (`REPLACE_WITH_D1_DATABASE_ID`, `REPLACE_WITH_KV_NAMESPACE_ID`), then:

```bash
npx wrangler deploy
```

Open the `*.workers.dev` URL wrangler prints. Every URL redirects to `/install` until you finish the wizard. Tables are created by the installer, so there is no migration command to run.

To use your own domain, add it under **Workers & Pages → your worker → Settings → Domains & Routes**, or uncomment the `[[routes]]` block in `wrangler.toml` and redeploy.

## Deploy from a phone (Termux)

Wrangler's local runtime has no Android build, so it will not install in plain Termux. Run it inside an Ubuntu container instead:

```bash
pkg update && pkg install proot-distro
proot-distro install ubuntu
proot-distro login ubuntu

# now inside Ubuntu
apt update && apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
git clone https://github.com/rizwanahmedsora9-pixel/ams-builds.online.git
cd ams-builds.online && npm install
```

Browser login is unreliable on a phone, so use an API token: in the Cloudflare dashboard go to **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**, add **D1: Edit** to its permissions, then:

```bash
export CLOUDFLARE_API_TOKEN=your-token
npx wrangler d1 create edge_cms
npx wrangler kv namespace create KV
npx wrangler r2 bucket create edge-cms-media
nano wrangler.toml          # paste the two IDs
npx wrangler deploy
```

No terminal at all: put the IDs in `wrangler.toml`, push to GitHub, and connect the repository under **Workers & Pages → Create → Import a repository**. Cloudflare then deploys on every push.

## Local development

```bash
npm run dev          # http://localhost:8787, local D1/KV/R2 in .wrangler/
npm run typecheck
```

Delete `.wrangler/` to start again from the installer. Trigger the cron locally with `npx wrangler dev --test-scheduled` and `curl "http://localhost:8787/__scheduled"`.

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

KV allows 1,000 writes a day on the free plan. Each first view of a page after an edit costs one write, as does each edit and each failed login. A small site stays well inside this; a busy one should move to the paid plan.

## File tree

```
wrangler.toml
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
      media.ts             R2 media library
      settings.ts
  db/
    schema.sql
    index.ts               schema runner
    migrations/index.ts    forward-only migrations
  lib/
    auth.ts                passwords, sessions, CSRF, roles
    security.ts            escaping, sanitizer, rate limiting
    render.ts              template engine, theme rendering
    content.ts             content queries, permalinks
    config.ts              KV config, settings
    time.ts                timezone helpers
    ui.ts                  admin HTML helpers and CSS
  themes/default/          theme.json, templates, style.css
```
