# Edge CMS

A WordPress-style CMS that runs as one Cloudflare Worker (TypeScript + Hono) serving the public site and the admin panel, with D1 for data and KV for uploaded media, the install lock, config and page cache. No R2 and no payment card are needed. The same code also runs on plain Node.js with a SQLite file and a media folder, so it works on any VPS, in Docker or on your own computer.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Installer, login, dashboard, pages, posts (categories, tags, featured image, scheduling), media, settings, default theme, page cache | **done** |
| 2 | Menus, themes and the theme store | **done** |
| 2 | Comments and moderation, users and roles, custom code, redirects, sitemap.xml, robots.txt, RSS | **done** |
| 3 | Backups, plugins and hooks, import/export, updates and site health | **done** |
| 3 | Multi-site | later |
| 4 | Panel overhaul: design system, lists, dashboard (Phase 0–2 of `docs/panel-overhaul-roadmap.md`) — revisions, autosave, edit locks, media picker, page order | **done (0.5.0)** |
| 5 | Theme platform: theme packages with assets, template engine v2, manifest v2, inheritance, theme versions and CSP (Phase 3 of the roadmap) | **done (0.6.0)** |
| 6 | Appearance hub and live Customizer: design tokens, signed-cookie preview, per-theme settings, widget areas, per-page templates, Identity (Phase 4 of the roadmap) | **done (0.7.0)** |

The full database schema is created at install. Existing sites upgrade themselves:
pending tables and columns are added by the cron trigger, by `npm start`, or from
**Updates → Run updates now**.

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

```
npm test              # asset budgets, then the end-to-end suite on Node.js
npm run test:cloudflare   # same suite against wrangler dev (D1 + KV)
npm run test:all      # both
npm run check:assets  # panel CSS/token budgets only (fast)
```

`tests/e2e.mjs` boots a real server on an empty data folder and walks the whole
product over HTTP. `tests/helpers.mjs` holds the shared harness (server lifecycle,
cookie jar, CSRF, install-and-login helper), so a new test starts from a working
panel in three lines.

`tests/template.test.mjs` (11 cases) tests the template engine directly — escaping, comparisons,
loops and their helpers, every filter, date patterns, partials, layout blocks and the parser's
error messages. It runs against `dist/template.mjs`, the same bundle the server uses.

`tests/panel.test.mjs` (39 cases) covers the panel itself: the shell renders once,
every screen loads, the palette markup and its live region, global search end to end
(full page, `partial=1` fragment, session guard, escaped query), the rail / scheme /
density cookies, the shared list pattern and its empty states, the dashboard's
priority order, and the accessibility floor - including a rule that every
`outline: none` in the panel CSS must be paired with a wrapper that draws its own
focus ring. The Phase 2 cases cover revisions and restore, autosave recovery, the edit lock
(two real sessions), the media picker, quick edit/duplicate/pin, page ordering, theme previews and
the upgrade path (the schema tables are dropped under the running server, the panel must keep
working and *Run updates* must bring the features back). The Phase 3 cases install a zip theme with
partials, a logo, a font-free stylesheet and three typed settings, then assert what a visitor sees:
the partial renders, `{{post.date | date "Y-m-d"}}` formats, `{{asset}}` points at a served file, the
CSS is linked rather than inlined, settings reach the markup, a snapshot can be reverted, a child
theme inherits from its parent, the validator reports broken templates, and the CSP header matches
the nonce on the page.

The Phase 4 cases install a theme that declares settings, two widget areas and an extra template, then prove
the Appearance work: six screens in one sidebar section, one control per token the theme honours (and a list of
the ones it does not), an unsaved brand colour reaching `/?preview=1&customize=1` through a signed cookie and
never the query string, the public site unchanged by a preview, a tampered or session-less cookie ignored, a
save persisting tokens and theme settings while a bad colour is refused by name, generated controls for a
manifest that needed no code, widget areas rendering where the theme draws them (titles escaped, bodies raw),
a page rendering its own template on the public site and falling back when the template is gone, Identity
writing the favicon and `og:image`, and the Customizer still saving without JavaScript.

## The admin panel

The sidebar mirrors WordPress: Dashboard, Updates, Posts, Media, Pages, Comments,
Appearance, Plugins, Users, Tools and Settings, with a **Collapse Menu** control at
the bottom (remembered in the browser). Sub-menus appear for the section you are in,
and the pending-comment count is shown as a badge.

The panel is one shell built from a small component kit (`src/admin/components.ts`):
page headers, cards, tables, tabs, badges, notices, empty states, pagination and
dialogs. Screens render those instead of hand-written markup, so they look and
behave the same and a change lands everywhere at once.

- **Preferences** (sidebar footer, or the account menu) sets the colour scheme
  (match the system, always light, always dark), the density and whether the
  sidebar starts collapsed. These are cookies applied while rendering, so there is
  no flash of the wrong theme and no layout jump on load.
- **Icons** are one inline SVG sprite per page. No icon font and no emoji in the
  interface.
- **Styling** is three cacheable files (`tokens.css`, `app.css`, `screens/*.css`)
  stamped with the app version and served with `Cache-Control: immutable`. Pages
  carry no inline stylesheet, so an admin page is a few KB of HTML.
- **Design tokens** (colours, spacing, radii, type scale) live in
  `src/admin/assets/tokens.css`. Components and screens reference them only, which
  is what makes light, dark and compact density work everywhere without special
  cases. `npm run check:assets` fails the build if a screen hard-codes a colour or
  a bundle grows past its budget.

- **Command palette** - `Ctrl`/`⌘`+`K` (or `/` when not typing) opens a search-and-command
  launcher from anywhere in the panel: type to search every post, page, file, comment,
  category, tag and user you are allowed to see, or pick a command (`Add post`, `Settings`,
  `Media`…). Results are fetched as a fragment from `GET /{admin}/search?q=`; with JavaScript
  off, the same box submits to the full search page. The same query is available as a plain
  link, so search results can be bookmarked.
- **Lists** - posts and pages share one pattern: status tabs with counts, a search and filter
  toolbar, sortable columns (`aria-sort`), one bulk-action bar that activates on selection, and
  an empty state that offers the next step. Below 700 px each row becomes a card with its
  column labels, so the panel is usable on a phone without sideways scrolling.
- **Dashboard** - opens with a greeting, the site name and a **Needs attention** list: comments
  waiting, spam to check, scheduled posts that are overdue, posts untouched for 60 days, images
  without alt text, media records with no file, pending database updates and idle author
  accounts. Items are ordered by severity, each one links to the screen that fixes it, and each
  check fails quietly if the data is not there yet. Below it: site totals, recently edited
  content, latest comments and version/schema/theme at a glance.

### Writing: safe, fast, and never a surprise

- **Nothing is lost.** Every save keeps a snapshot of the previous version, and while you type the
  editor autosaves every 30 seconds. Autosaves go to the history, not to the live post, so a crash or
  a closed tab leaves your work recoverable while the published page keeps showing the last real
  save. The editor tells you when it last saved and warns you before leaving with unsaved changes.
- **History and restore.** *History* in the editor lists every version (manual saves and autosaves
  are labelled), shows a line-by-line diff of what changed, and restores any of them in one click —
  the version you replace is snapshotted first, so a restore is reversible too. The 25 most recent
  versions are kept per post.
- **No silent overwrites.** Opening a post puts an advisory lock on it for 2.5 minutes, refreshed
  while you work. If someone else has it open, you see "Alice is editing this post right now";
  editors can take it over with *Edit anyway*. Saving never blocks, so a lost connection cannot
  strand a post.
- **Media without leaving the page.** The featured image and the editor's *Image* button open the
  same picker: search the library, set the alt text, or upload a new file right there.
- **Fast fixes from the list.** Each row has Edit · Quick edit · Duplicate · History · View · Pin ·
  Preview in theme. *Quick edit* changes title, slug, status, date, categories and tags in place;
  *Duplicate* makes a draft copy; *Pin* floats a row to the top.
- **Page order.** The Pages screen has an *Order* panel. The same order reaches themes through
  `{{#each pages}}`, so a menu built from pages matches what you set.
- **Preview in any theme.** `?preview=1&theme=<slug>` renders the post with any installed theme,
  for signed-in users only and never cached.

The account menu (top right) holds Profile, Preferences, colour scheme shortcuts
(light / dark / match system) and Log out. Rail state, scheme and density are also
one-click links (`/rail/collapsed`, `/scheme/dark`), so they work with JavaScript off.
A screen that fails to render shows a styled error page naming the route, instead of a
blank 500.

| Section | What it does |
| --- | --- |
| Dashboard | Greeting, **Needs attention** checklist (each item links to the fix), site totals, recently edited content, latest comments, version, schema and theme |
| Updates | CMS version, database schema, pending migrations (with a button), theme updates, plugin states and the last backup |
| Posts | Shared list pattern with thumbnails and a row menu (edit, quick edit, duplicate, history, pin, preview in theme); status tabs, search, date/category filters, sortable columns, bulk publish/draft/delete, card layout on phones; add new, **Categories** and **Tags**; editor, excerpt, featured image, SEO, draft/published/scheduled |
| Media | Searchable grid/list library with type and date filters, bulk delete, copy URLs, alt-text editing and uploads (images, PDF, audio, video, fonts) to KV (Cloudflare) or `data/media/` (Node). The media picker in the editor uses the same library |
| Pages | Same list pattern as Posts, plus a **Page order** panel that themes inherit; status/date filters and bulk publish/draft/delete; add new; a tick adds a page to the header menu |
| Comments | Moderate with All / Pending / Approved / Spam / Trash filters, approve, unapprove, spam, trash, delete and reply as yourself |
| Appearance | **Customize** (design tokens, the theme's own settings, custom code, live preview), **Themes**, **Templates**, **Menus**, **Widgets** (the areas the theme declares), **Identity** (logo, favicon, social image) |
| Plugins | Built-in XML sitemap, robots.txt and RSS feed can be switched off; add your own snippet to `<head>` or before `</body>` |
| Users | Add, edit, re-role and delete accounts; Profile changes your own email and password |
| Tools | Redirects (301/302), JSON import/export, server-stored backups, site health, page-cache reset |
| Settings | Site identity and favicon, reading (home page, posts per page, permalinks, default editor), discussion (comments and moderation), domains and the admin URL |

## Writing posts and pages

Every post and page can be written two ways, and you choose which one you want:

- **Classic editor** — the compact original: a small formatting bar above a plain editing box.
- **Modern editor** — the same tools in a roomier layout with a framed toolbar and a wider writing surface.

Add New and Edit ask **Modern editor / Classic editor** the first time. Pick one and
it is remembered on that device; change the site-wide default under
**Settings → Reading → Default editor** (`Ask every time`, `Modern editor`,
`Classic editor`). You can switch instantly from the **Classic / Modern** buttons
inside the editor at any time — the content is the same either way.

The **Text** and **HTML** tabs show the same content: Text is the visual editor and
HTML is the underlying markup. Switching back and forth keeps everything, and both
tabs support the formatting buttons, HTML blocks and YouTube embeds. Content that
starts with a `<style>` or `<script>` block always opens in HTML so it is never
mistaken for page markup. Without JavaScript the HTML textarea still saves normally.

Roles: **admin** has everything, **editor** manages all content, media, menus and
comments, **author** only writes and edits their own posts and uploads. You cannot
delete your own account, demote yourself, or remove the last admin.

## Menus

- Tick **Show in the main menu** when editing a page and it is linked in the site header once published. New pages start ticked.
- **Menus** in the admin panel lets you reorder links (drag the handle or use the arrows), rename them, add custom links, and create a footer menu.


## Comments

Visitors can comment on posts without JavaScript and without an account: a name,
an email (never published) and the comment. Each form carries a signed token, a
honeypot field and a per-IP rate limit (five comments per ten minutes); pages stay
cacheable because the token is valid for two days.

New comments wait for moderation by default. Turn that off, or close comments
entirely, in **Settings → Discussion**. Moderators can reply as themselves (the
reply is labelled *staff*), mark spam or move a comment to the trash. Approved
comments are part of the cached page, so moderating bumps the cache.

Themes get `{{{comments_html}}}` on posts (the bundled themes already include it).
A theme without that tag still shows comments: they are appended after the post
content. Comment bodies are stored as plain text and escaped on output.

## Plugins and custom code

**Plugins** has two halves:

- **Built-in**: XML sitemap (`/sitemap.xml`), robots.txt (`/robots.txt`) and RSS
  (`/feed.xml`). Each can be deactivated and comes back instantly.
- **Your plugins**: snippets of HTML injected into `<head>` or before `</body>` on
  every public page — analytics, verification tags, chat widgets. They run after
  the active theme.

**Appearance → Customize → Custom code** holds site-wide additional CSS, header code,
footer code and JavaScript. Both screens are admin-only because the code is saved
raw, exactly like theme code. Everything they save bumps the page cache. The rest of
that screen — colours, type, layout and a live preview of the real site — is described
under [Appearance](#appearance).

## Tools, backups and updates

- **Redirects** — a path is redirected before the page cache, so changes apply at
  once. 301 or 302, relative or absolute targets.
- **Import / Export** — one JSON file with content, terms, menus, comments,
  redirects, settings and the user list (never password hashes). Import merges by
  type and slug, so running it twice is safe.
- **Backups** — the same JSON stored on the server (KV on Cloudflare, `data/media/backups/`
  on Node) and downloadable from the panel. The public `/media/` route never serves them.
- **Site Health** — database, key-value store and media checks, versions, schema,
  cache generation and content counts.
- **Updates** — the CMS version, the database schema and pending migrations, theme
  updates from the store, plugin states, and buttons to run migrations or install a
  theme update.

## Appearance

Everything about how the site looks lives under one sidebar section:

```
Appearance
├── Customize   tokens · live preview · the theme's own settings · custom code
├── Themes      store · installed · upload · editor · revisions
├── Templates   what the active theme offers, and which pages override it
├── Menus       header and footer links
├── Widgets     the areas the active theme declares
└── Identity    logo, favicon, social image, colour scheme default
```

**Customize is a split pane**: the controls on the left, the real site in an iframe on the right, three
device widths above it. There is no separate preview renderer — the iframe is the public site, so what you
see is what a visitor gets.

### Design tokens

A site's brand is a handful of `settings` keys, emitted as one `:root{…}` block **after** the theme's own
stylesheet and before your custom CSS:

| Control | Emits | Also reaches |
| --- | --- | --- |
| Brand colour | `--brand` | `--accent`, `--primary`, `--link`, `--gold` |
| Second brand colour | `--brand-alt` | `--accent-2`, `--primary-2` |
| Text on brand | `--on-brand` | `--accent-fg`, `--on-accent` |
| Text / muted text | `--text`, `--text-muted` | `--fg`, `--ink`, `--muted`, `--subtle` |
| Background / cards / lines | `--bg`, `--surface`, `--line` | `--card`, `--panel`, `--soft`, `--border`, `--rule` |
| Corner radius | `--radius` | `--r`, `--radius-md`, `--round` |
| Type: body stack, headings, size | `--font-body`, `--font-head`, `--type-scale` | `--font`, `--font-sans`, `--serif`, `--font-size` |
| Content width | `--width` | `--max`, `--container`, `--wrap`, `--read` |
| Colour scheme | `<meta name="color-scheme">` | every theme follows it |

Two rules make this safe rather than decorative:

1. **Only what the theme reads is emitted.** The Customizer reads the active theme's stylesheet and offers a
   control only for a variable that stylesheet uses or declares. Themes name the same idea differently, so a
   brand colour is emitted under whichever of its aliases this theme actually has. A token a theme cannot
   honour is listed under **Not offered by &lt;theme&gt;** instead of pretending to work.
2. **Nothing is invented.** An unset token emits no CSS at all, so an untouched site is byte-identical to
   what it was before this screen existed. A token is validated on save (`#rrggbb` only) and clamped on
   ranges, so a value pasted into a colour box cannot become CSS injection.

The type stacks are curated and system-first (`system`, `humanist`, `rounded`, `serif`, `mono`, or your own
stack): no webfont download and nothing from another server.

### The live preview channel

Unsaved values have to reach the renderer, and three rules decided how:

- **Never in the query string.** A URL is logged, shared and cached; `?tokens={…}` would leak half-written
  settings.
- **Never trusted from the browser.** `POST /appearance/preview` validates the posted values exactly as a save
  would, then mints `ams_preview`: an HMAC-signed, `HttpOnly`, `SameSite=Strict` cookie with a 30-minute TTL
  that carries only the *differences* from what is saved.
- **Never cached, never public.** It is read only for a signed-in admin, the page it affects is `no-store`,
  and it is ignored entirely without a session. A tampered signature is discarded.

The iframe reloads on a 300 ms debounce, so typing a colour is smooth and the last change always wins.
`?preview=1` pages relax `X-Frame-Options` to `SAMEORIGIN` and add `frame-ancestors 'self'`, so the panel can
frame its own site and nobody else can. **Save** commits tokens, the theme's settings and the custom code;
**Discard** ends the preview. Without JavaScript the same form still saves, and the preview opens in a tab.

### Per-theme settings, with no code

A theme declares typed settings in `theme.json` (`text`, `textarea`, `toggle`, `color`, `select`, `number`,
`image`, `url`) and the Customizer renders the right control for each one — a new theme needs no route, no
form and no code in the panel. Values are stored per theme in `theme_settings`, exposed as `{{theme.key}}`
and `{{#if theme.key}}`, and edited in the same place as the tokens. They are previewed unsaved too.

### Widget areas

A theme declares the places it puts widgets in:

```json
{ "widgets": ["footer", "sidebar"] }
```

or with labels: `[{ "key": "footer", "label": "Footer", "help": "Three columns." }]`. Each area holds three
slots (title, HTML body), stored as `widget_footer_1_title` and so on. A theme draws one where it wants it:

```html
{{{widgets.footer}}}
```

An area the theme does not draw itself is appended with `{{{footer}}}`, so a filled area is never invisible —
and a drawn area is not repeated. A theme that declares nothing gets the classic footer area, under exactly
the keys every existing site already has.

### Per-page templates

The editor's **Publish → Template** dropdown lists the templates of the active theme (a theme adds
`page-landing` by shipping `page-landing.html`). The choice is stored in `content.template` (schema 6) and
resolved when the page is rendered. It is only stored when the template exists, and a page whose template
disappears with a theme change falls back to the default template for its kind instead of rendering blank.
**Appearance → Templates** lists what the theme offers and which pages use an override.

### Custom code

The four raw boxes (CSS, header, footer, JavaScript) moved under a collapsed **Custom code** section with the
same behaviour: admin-only, added verbatim to every page, stamped with the page's CSP nonce.

## Themes

**Themes** in the admin panel has a built-in store, a manager for every installed theme, an uploader and a
validator. A theme package can ship templates, partials, a stylesheet and binary assets (logo, fonts, one
`theme.js`), and a theme can inherit from another one.

| Store theme | Look |
| --- | --- |
| AMS Base | The standard theme: light and minimal. Installed by default. |
| AMS Pro | Sticky header with pill-style tab navigation, colour hero, post grid, three-column dark footer. |
| AMS Premium | Dark header with top bar and underlined tabs, serif headlines, large hero, rich footer. Inherits Pro's page, post and archive templates through `"parent": "ams-pro"`. |

All three use system fonts, load nothing from other servers, need no JavaScript and follow the visitor's
light or dark setting. Store themes live in `src/themes/`; add a folder and list it in `src/themes/index.ts`
to ship another.

### What a theme package is

```json
{
  "name": "Journal",
  "slug": "journal",
  "version": "1.2.0",
  "author": "You",
  "description": "Single column, serif, generous whitespace.",
  "layout": "base",
  "parent": null,
  "tags": ["blog", "serif"],
  "templates": { "base": "base.html", "home": "home.html", "post": "post.html" },
  "partials": { "header": "partials/header.html" },
  "css": "style.css",
  "assets": ["assets/logo.png", "fonts/body.woff2"],
  "screenshot": "assets/screenshot.png",
  "settings": [
    { "key": "accent", "type": "color", "label": "Accent", "default": "#b4552d" },
    { "key": "show_tagline", "type": "toggle", "label": "Show tagline", "default": true },
    { "key": "archive_layout", "type": "select", "label": "Archive layout", "default": "grid",
      "options": [ { "value": "grid", "label": "Grid" }, { "value": "list", "label": "List" } ] }
  ],
  "widgets": ["footer", "sidebar"],
  "changelog": [ { "version": "1.2.0", "notes": "Added the landing template." } ]
}
```

Upload a `.zip` with this `theme.json` next to the files it names (or a single `.json` bundle, the way
themes were written before — those still load). Only `base` — or a `parent` to inherit from — is required;
anything else falls back to AMS Base. `partials/header.html` is picked up without being declared, and
everything under `assets/` is stored as a theme asset.

**Limits:** 6 MB upload, 512 KB per asset, 80 assets, PNG/JPEG/GIF/WebP/AVIF/ICO, WOFF/WOFF2/TTF/OTF and a
`theme.js`. **SVG and HTML are refused on purpose** — they can carry script, and theme assets are served
from your own origin.

### Assets are files, not inline text

The stylesheet and every other asset is served from `/theme-assets/{slug}/{path}` with a one-year immutable
cache, an ETag and `nosniff`. That is why pages are small: the CSS is downloaded once per visitor, not
shipped in every page view. In a layout:

```html
{{#if theme_css_url}}<link rel="stylesheet" href="{{{theme_css_url}}}">{{/if}}
<img src="{{asset "assets/logo.png"}}" alt="Logo">
<script defer src="{{asset "theme.js"}}"></script>
```

`{{{theme_css}}}` still renders the same CSS inline for themes that have not moved over yet.

### Template tags

| Category | Syntax |
| --- | --- |
| Values | `{{post.title}}` (escaped), `{{{post.content}}}` (raw), `{{this}}`, `{{@index}}`, `{{@first}}`, `{{@last}}`, `{{@key}}` |
| Conditions | `{{#if x}}…{{else}}…{{/if}}`, `{{#unless x}}…{{/unless}}`, `{{#if n gt 3}}`, `eq ne gt gte lt lte and or not`, parentheses |
| Loops | `{{#each posts}}…{{else}}no posts{{/each}}`, `{{#each posts limit=3}}`, `{{#each posts limit=3 offset=2}}`, objects too |
| Partials | `{{> header}}`, `{{> post-card post}}`, `{{> @theme "header"}}` (from the parent theme) |
| Layout | `{{#block content}}…{{/block}}` in the layout, `{{{content}}}` also works |
| Filters | `{{post.date \| date "d MMM yyyy"}}`, `truncate`, `strip_html`, `slug`, `json`, `default`, `upper`, `lower`, `capitalize`, `reading_time`, `number_format`, `asset`, `url`, `escape`, `nl2br` |
| Assets | `{{asset "logo.png"}}`, `{{{theme_css_url}}}` |
| Settings | `{{theme.accent}}`, `{{#if theme.show_tagline}}` |
| Widgets | `{{{widgets.footer}}}` (an area the manifest declares), `{{#each widget_areas}}` |
| Meta | `{{{head}}}`, `{{{footer}}}`, `{{{comments_html}}}`, `{{body_class}}`, `{{nonce}}` |

Every helper is a pure function over the data the CMS supplies: a template cannot execute code. An unknown
filter is a no-op, a missing value renders empty, and a broken template shows up in **Validate a theme**
(unknown filters, missing partials, assets the manifest promises but does not ship, a layout with no page
slot) before it ever goes live.

| Available in | Values |
| --- | --- |
| every template | `site.title`, `site.tagline`, `site.url`, `site.logo`, `site.social_image`, `site.favicon`, `year`, `body_class`, `nonce`, `tokens` (the design tokens as data), `scheme`, `widget_areas`, `menu.primary` and `menu.footer` (lists of `label`, `url`, `active`), `pages` (published pages in the order set on the Pages screen) |
| `base` (or the layout) | `{{{head}}}`, `{{{theme_css}}}`, `{{{theme_css_url}}}`, `{{{content}}}`, `{{{footer}}}`, `{{{widgets.footer}}}`, `{{{widgets.sidebar}}}` |
| `home` | `page` (the chosen home page, may be empty), `posts` (latest five) |
| `page` | `page.title`, `{{{page.content}}}` |
| `post` | `post.title`, `{{{post.content}}}`, `post.date`, `post.date_iso`, `post.author`, `post.featured_image`, `post.featured_alt`, `post.categories` and `post.tags` (lists of `name`, `url`), `{{{comments_html}}}`, `comments_count`, `comments_open` |
| `archive` | `archive.title`, `posts`, `pagination.prev`, `pagination.next` |
| each item of `posts` | `title`, `url`, `excerpt`, `date`, `date_iso`, `featured_image`, `featured_alt` |

### Settings, history and previews

- **Theme settings** a theme declares are editable in the Customizer (**Appearance → Customize**) and under
  **Themes → (your theme)** — the same values, two doors — and available in
  templates as `{{theme.key}}`. Defaults come from the manifest; changes are stored per theme and
  **Reset to defaults** throws them away.
- **History** — every activation or upload snapshots the theme first, so **Revert** brings the previous
  files back. The revert itself is reversible; ten snapshots are kept per theme.
- **Preview** any installed theme at `/?preview=1&theme=slug` while signed in (never cached, never public).
- **A theme that throws** while rendering cannot take the site down: the page falls back to AMS Base and
  the Themes screen says which theme failed and why.
- Themes contain markup, so only install themes you trust.

### Content-Security-Policy

The site sends a policy on every page: scripts only from your own site plus inline code carrying that
page's nonce, images from anywhere over HTTPS, and no plugins or objects. Your own custom CSS/JavaScript and
snippet hooks are stamped with the nonce automatically, and a theme's script is a served file, so both keep
working. Set it under **Settings → Content security policy**: *Report only* (default — the browser logs
what would be blocked and blocks nothing), *Enforce*, or *Off*. Start on report-only for a day, then enforce.

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
      index.ts             CSRF, login, logout, dashboard, profile, error boundary
      assets/tokens.css    design tokens: colour, space, radius, type, schemes
      assets/app.css       shell (top bar, rail, palette) and component kit
      assets/screens/      one file per screen family as it is rebuilt
                           (dashboard.css, lists.css, editor.css,
                           appearance.css, legacy.css)
      components.ts        pageHead, card, table, tabs, emptyState, notice, ...
      icons.ts             inline SVG sprite
      preferences.ts       colour scheme, density, rail state (per browser)
      shell.ts             route: palette search, rail/scheme/density links
      search.ts            site-wide search across content, media, comments, users
      palette.ts           command palette script and its endpoint config
      attention.ts         "needs attention" checks for the dashboard
      revisions.ts         save snapshots, line diff, autosave retention, edit locks
      editor-views.ts      revision list, diff and editor banners (server-rendered)
      media-picker.ts      the picker dialog and its client script
      assets/screens/editor.css   editor-only styles (History, banners, picker)
      assets.ts            route: GET /{admin}/assets/*.css (immutable, ETagged)
      bundles.ts           CSS bundle registry: tokens, app, screens + ETags
      content.ts           pages and posts
      media.ts             media library
      settings.ts
      menus.ts               menu editor
      themes.ts              theme upload, activate, delete
      comments.ts            comment moderation and replies
      users.ts               accounts and roles
      plugins.ts             built-in plugins and code snippets
      tools.ts               redirects, import/export, backups, health
      updates.ts             versions, migrations, theme updates
      appearance.ts          customize (CSS/code) and footer widgets
      terms.ts               categories and tags
  node/
    server.ts              Node.js entry point (PORT, DATA_DIR, TRUST_PROXY)
    storage.ts             SQLite + disk versions of D1, KV and file storage
  db/
    schema.sql
    index.ts               schema runner
    migrations/index.ts    forward-only migrations (statement-tolerant; v3 revisions, v4 order)
  lib/
    auth.ts                passwords, sessions, CSRF, roles
    security.ts            escaping, sanitizer, rate limiting
    files.ts               uploaded files: KV on Cloudflare, disk on Node
    themes.ts, zip.ts      theme bundle reader (JSON or zip)
    menus.ts               page-to-menu sync
    render.ts              template engine, theme rendering
    content.ts             content queries, permalinks
    comments.ts            comment storage, tokens, public rendering
    plugins.ts             built-in plugin list and hook points
    version.ts             app version shown in Updates
    schema.ts              cached "does this table/column exist" probes for upgrade safety
    template.ts            template engine v2: expressions, filters, partials, layouts
    theme-manifest.ts      theme.json v2: validation, zip reading, inheritance, settings
    theme-store.ts         theme rows, assets, version snapshots, layout rendering
    config.ts              KV config, settings
    time.ts                timezone helpers
    ui.ts                  admin HTML helpers and CSS
  themes/
    index.ts               theme store list
    default/               AMS Base
    pro/                   AMS Pro
    premium/               AMS Premium
```
