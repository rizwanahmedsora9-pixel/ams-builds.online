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
| 7 | Theme store & lifecycle: screenshots, live preview, in-panel file editor, zip export, rollback, two new bundled themes (Phase 5 of the roadmap) | **done (0.8.0)** |
| 8 | Governance and performance: audit log, capabilities instead of hard-coded roles, enforced performance budgets, panel strings in one catalogue, export v2 (Phase 6 of the roadmap) | **done (0.8.0)** |
| 9 | The writer's editor: a full formatting bar with shortcuts, a link dialog, image blocks with caption/alt/link, drag anchors and paste-or-drop upload, paste-as-text, page breaks, live word count and slug preview, mark-up tidying on save | **done (0.9.0)** |

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

`tests/origin.test.mjs` (5 cases) covers the site-name rule: the domain a request
arrived on becomes a readable name, an admin's own title always wins, and an IP or
a generated preview suffix never becomes a name.

`tests/template.test.mjs` (12 cases) tests the template engine directly — escaping, comparisons,
loops and their helpers, every filter, date patterns, partials, layout blocks and the parser's
error messages. It runs against `dist/template.mjs`, the same bundle the server uses.

`tests/panel.test.mjs` (50 cases) covers the panel itself: the shell renders once,
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

The Phase 5 cases do the whole lifecycle in the panel: install **AMS Journal** from the store, watch its
screenshot become a real `background-image` only once installed, preview **AMS Portfolio** in an iframe,
edit a partial and a stylesheet in the textarea editor (the public site changes at once), validate, roll
back to the snapshot taken before the edit, export the theme as a zip and upload that same zip back, and
start a new theme from a blank and from a child template.

The Phase 6 cases read the audit log from the outside: a save, two theme activations and a delete each
produce a readable entry, filters are linkable GET parameters, and the log is newest-first. A second
identity signs in as an author in its own cookie jar and is refused pages, themes, settings, users and the
audit log by capability while the sidebar hides them; the role map is checked directly, and the panel
strings come from the `en` catalogue (and a separate test greps the source for every `t('…')` key to prove the
catalogue has them all). The health screen is checked against `src/lib/budget-report.json`,
and an export is checked to be format version 2 with themes, theme settings and revisions and no password
material.

## The admin panel

A WordPress-shaped sidebar — Dashboard, Updates, Posts, Media, Pages, Comments, Appearance, Plugins, Users,
Tools, Settings — over one server-rendered shell. Lists share one pattern (status tabs, filters, sortable
columns, bulk actions, cards on a phone), the command palette opens with `Ctrl`/`⌘`+`K`, writes are
autosaved and versioned, and no screen needs JavaScript to work.

- [**Panel Guide**](docs/panel-guide.md) — every screen, how writing and history work, who may change what,
  and the audit log.
- [**Theme Developer Guide**](docs/theme-developer-guide.md) — the manifest, template tags, assets, settings,
  screenshots, zip packages and the CSP.
- [**Panel overhaul roadmap**](docs/panel-overhaul-roadmap.md) — what was built in which release and why.

| Section | What it does |
| --- | --- |
| Dashboard | Greeting, **Needs attention** checklist (each item links to the fix), site totals, recently edited content, latest comments, version, schema and theme |
| Updates | CMS version, database schema, pending migrations (with a button), theme updates, plugin states and the last backup |
| Posts | Shared list pattern with thumbnails and a row menu (edit, quick edit, duplicate, history, pin, preview in theme); status tabs, search, date/category filters, sortable columns, bulk publish/draft/delete, card layout on phones; add new, **Categories** and **Tags**; editor, excerpt, featured image, SEO, draft/published/scheduled |
| Media | Searchable grid/list library with type and date filters, bulk delete, copy URLs, alt-text editing and uploads (images, PDF, audio, video, fonts) to KV (Cloudflare) or `data/media/` (Node). **Browser-side WebP compression** before upload, every common image format (JPG/JFIF, PNG/APNG, GIF, WebP, AVIF, BMP, TIFF, HEIC, JXL, ICO, SVG), and a two-tab picker in the editor: already-uploaded images, or upload straight from the device |
| Pages | Same list pattern as Posts, plus a **Page order** panel that themes inherit; status/date filters and bulk publish/draft/delete; set or clear the page shown on the first-visit landing screen; a tick adds a page to the header menu |
| Comments | Moderate with All / Pending / Approved / Spam / Trash filters, approve, unapprove, spam, trash, delete and reply as yourself |
| Appearance | **Customize** (design tokens, the theme's own settings, custom code, live preview), **Themes** (store, installed, editor), **Templates**, **Menus**, **Widgets**, **Identity** |
| Plugins | Built-in XML sitemap, robots.txt, RSS feed and **Search Console Verification** (paste Google/Bing/Yandex meta tag → live in `<head>`) can be switched off; add your own snippet to `<head>` or before `</body>` |
| Users | Add, edit, re-role and delete accounts; Profile changes your own email and password |
| Tools | Redirects, JSON import/export (v2, includes themes), server-stored backups, site health with performance budgets, audit log, page-cache reset |
| Settings | Site identity and favicon, reading, customizable first-visit landing screen with an ordered looping soundtrack (each file uploads on its own, with progress, so a slow connection cannot lose the rest of the form), discussion, domains and the admin URL |

## The site name follows the domain

The installer starts with the name taken from the domain it was opened on
(`ams-builds.online` → *Ams Builds*, `ams.vercel.app` → *Ams*), and writes no
title of its own. Until an admin types one in **Settings → Site title**, every
page derives the name from the host that served it — so the same code deployed
again for another domain, or answering on a platform address as well as a custom
domain, names itself correctly without being retyped. Type a title and it wins
everywhere, on every host. An IP address has no name to take, so there the stored
title is used.

## Writing posts and pages

Every post and page can be written two ways, and you choose which one you want:

- **Classic editor** — the compact original: a small formatting bar above a plain editing box.
- **Modern editor** — the same tools in a roomier layout with a framed toolbar and a wider writing surface.

Add New and Edit ask **Modern editor / Classic editor** the first time. Pick one and
it is remembered on that device; change the site-wide default under
**Settings → Reading → Default editor** (`Ask every time`, `Modern editor`,
`Classic editor`). You can switch instantly from the **Classic / Modern** buttons
inside the editor at any time — the content is the same either way.

### The formatting bar

One bar, the same tools in both skins:

| Group | Buttons |
| --- | --- |
| Type | **B** bold, *I* italic, U underline, ~~S~~ strikethrough |
| Structure | H2, H3, H4, paragraph, bulleted list, numbered list, quote, code block, divider |
| Insert | **Link**, **Media**, **Page break**, **Featured image** (posts), **HTML block**, **YouTube** |

All of it works from the keyboard: **Ctrl/Cmd+S** saves, **Ctrl/Cmd+B / I / U** format,
**Ctrl/Cmd+Shift+K** makes a link from the selection, **Enter** confirms a dialog and
**Esc** closes it. (Ctrl/Cmd+K is the panel's command palette, so links use Shift.)

**Paste keeps the words, not the styling.** Anything from Word, Google Docs, a chat
window or another website arrives as plain text — the fonts, colours and table
layouts the sanitizer would drop anyway never reach the post. The exception is a
clipboard that is *only* an image URL: that becomes an image block. Shift+paste is
the deliberate escape hatch for markup.

### Placing an image

**Media** in the toolbar opens the picker, and the picture you choose opens **Place
this image** — a preview beside alt text, an optional caption, an optional link and
a width slider. Insert places it at **50% width, centred**, never full-bleed.

Pasting or dropping an image file straight onto the writing surface also works: it
is compressed in the browser, uploaded, and placed at the caret — one motion, no
dialog, several files at once.

In the Text tab, click any image to select it:

- four **corner anchors** to drag, and a bar with **S 25% / M 50% / L 75% / Full 100%**
  presets and a width slider;
- **Left / Center / Right** alignment (a floated image is cleared on narrow screens by
  every bundled theme);
- **Alt** — the description a screen reader reads, editable here rather than only in
  the media library;
- **Caption** — the words under the picture, add/edit/remove in place;
- **Link** — wrap the image in a link (empty removes it), checked against the same
  address rules as a text link;
- **Remove**.

Width is stored as a percentage and alignment as a class, so the published page
shows the image exactly as placed. The sanitizer keeps exactly those two things and
refuses a width it cannot honour (250%) instead of shipping a broken layout.

### Everything else in the editor

- **Links** are a dialog, not a `prompt`: address, the words to show, *open in a new
  tab*. Picking a link and pressing Link again **edits** it, including its words;
  Remove unwraps it. A `javascript:` address is refused before anything is saved.
- **Page break** inserts a `<hr class="page-break">`. It shows as a labelled dashed
  rule while you write and forces a page break when the post is printed — usable for
  invoices, scripts and handouts. Every bundled theme styles it.
- **Divider** inserts a plain `<hr>`, which every theme draws as a rule.
- **HTML block** and **YouTube** open a dialog with a live error. YouTube accepts
  watch, share (`youtu.be`), Shorts, live and embed URLs, and embeds the
  privacy-friendly `youtube-nocookie.com` player responsively.
- **Word count** in the editor bar shows the words a *reader* sees (markup and CSS are
  not counted), the reading time at 220 words a minute, and the character count. It
  updates as you type, in both tabs.
- **Slug** is previewed under its field and generated with the same function the
  server stores it with, so what you see is the URL you get.
- **Tidying on save.** The browser writes a `<div>` per Enter; the editor converts
  those line containers to real `<p>` paragraphs, unwraps redundant divs and removes
  empty leftovers, so a post saved from the visual editor is clean markup — never
  touching a custom block, a figure or a nested layout.
- **Nothing is lost.** Autosave every 30 seconds, a snapshot of every save, a warning
  before leaving with unsaved changes, and a lock while you work (see *Writing: safe,
  fast, and never a surprise* below).
- **Without JavaScript** the HTML textarea still saves normally, and content that
  starts with a `<style>` or `<script>` block always opens in the HTML tab so it is
  never mistaken for page markup.

**Media** in the toolbar (and **Choose image** for the featured image) opens one
dialog with two tabs. **Library** lists what is already uploaded, searchable by
file name and alt text. **Upload from device** takes one or many files by click or
drag and drop; raster images are resized to at most 2000 px and re-encoded as WebP
in the browser at the quality you pick (Tight by default), and the dialog reports
how much smaller each file got before it is sent. GIF animation and SVG are left
as they are, WebP/AVIF are kept, and a converted file is only used when it is
actually smaller. A format the browser itself cannot decode (HEIC on most desktop
browsers, for example) is flagged in the dialog rather than uploaded as a picture
most visitors could never see. Alt text is saved in the same step, so images
reach the site described and light.

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

- **Built-in**: XML sitemap (`/sitemap.xml`), robots.txt (`/robots.txt`), RSS
  (`/feed.xml`) and **Search Console Verification**. Each can be deactivated and
  comes back instantly. Verification is paste-and-go: **Plugins → Search Console
  Verification → Configure**, paste the whole `<meta name="google-site-verification" …>`
  tag Google gives you (or only the code inside `content="…"`, Bing and Yandex
  work the same way), **Save & activate**, then press **Verify** in Search Console.
  The tag is printed in `<head>` on every public page; clear the box or deactivate
  the plugin to remove it.
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
- **Import / Export** — one JSON file (format version 2) with content, terms,
  menus, comments, redirects, settings, installed themes with their templates,
  partials and stylesheets, per-theme settings, content revisions and the user
  list (never password hashes). Theme image and font assets stay in the file store
  and are named in the export. Import merges by type and slug, survives being run
  twice, and installs the themes in the file.
- **Backups** — the same JSON stored on the server (KV on Cloudflare, `data/media/backups/`
  on Node) and downloadable from the panel. The public `/media/` route never serves them.
- **Site Health** — database, key-value store and media checks, versions, schema,
  cache generation, content counts and the **performance budgets** (what this build
  measured against the limit, see below).
- **Audit log** — every change made in the panel: who, what, where, when. Filters
  by person, action, area and free text are GET parameters, so a view is a link.
  Entries are kept 90 days and pruned by the cron trigger.
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

### Design tokens and the live preview

The Customizer controls a handful of design tokens (brand colour, text, surfaces, radius, type, content
width, colour scheme). Each one is emitted as a `:root{…}` block after the theme's stylesheet, under whichever
alias the active theme actually reads — a token the theme cannot honour is listed under **Not offered by
&lt;theme&gt;** rather than pretending to work, and an unset token emits no CSS at all. Unsaved values reach the
preview through a signed `HttpOnly` cookie (`POST /appearance/preview`), never the query string, never for
anyone without a session, never cached.

The mechanics — which control emits which variable, how the preview channel is secured, how a theme's manifest
becomes controls with no code — are in the [Panel Guide](docs/panel-guide.md#appearance-the-look-live).

## Themes

**Themes** in the admin panel has a built-in store, a manager for every installed theme, an uploader and a
validator. A theme package can ship templates, partials, a stylesheet and binary assets (logo, fonts, one
`theme.js`), and a theme can inherit from another one.

| Store theme | Look |
| --- | --- |
| AMS Base | The standard theme: light and minimal. Installed by default. |
| AMS Pro | Sticky header with pill-style tab navigation, colour hero, post grid, three-column dark footer. |
| AMS Premium | Dark header with top bar and underlined tabs, serif headlines, large hero, rich footer. Inherits Pro's page, post and archive templates through `"parent": "ams-pro"`. |
| AMS Journal | Single column, serif text, a 34rem measure and large images. Header and footer are partials, six settings (measure, serif, accent, rules, byline, drop cap). |
| AMS Portfolio | A responsive grid with a full-width hero. Eight settings including hero text, grid columns and accent, driven by `--cols` and `--p-*` tokens. |

All five use system fonts, load nothing from other servers, need no JavaScript and follow the visitor's
light or dark setting. Each ships a `screenshot.png` that the store card shows (and a palette gradient when
a theme ships none). Store themes live in `src/themes/`; add a folder and list it in `src/themes/index.ts`
to ship another.

### Install, preview, customise, roll back

Everything happens in the panel: **Appearance → Themes** lists the store with screenshots, author, version
and tags; **Preview** opens the real site in an iframe with that theme, before it is installed; one click
installs and activates. Every install, update and save writes a row to the theme's **history**, so
**Update available vX → vY** appears with the changelog, and **Roll back** restores any earlier snapshot of
the templates, partials and stylesheet. Editing an installed theme in the panel (a file tree plus a plain
textarea, per-file save, validation on save) is snapshotted first, so nothing is lost. Local edits to a
theme that the store also ships prompt: keep my changes, replace with the store version, or save mine as a
copy.

**Export** downloads the theme as a zip (`theme.json` naming its files, `*.html`, `partials/*.html`,
`style.css`, assets); the **Import** box accepts that zip back, or `theme.json` on its own. Templates and CSS
round-trip byte-for-byte. **New theme from a template** starts from a blank theme or a child of an existing
one. The full reference is in the [Theme Developer Guide](docs/theme-developer-guide.md).

### Who can change what

Permissions are capabilities, not role names: `read`, `write_posts`, `edit_others_posts`, `manage_pages`,
`manage_themes`, `manage_users` and so on, listed in `src/lib/capabilities.ts` with the same defaults the
three roles always had (author: own posts; editor: all content, media, menus, moderation; admin: everything).
Every route and every sidebar entry asks for a capability, so adding a role later is a one-line change.
**Tools → Audit log** records who changed what for 90 days; see
[the Panel Guide](docs/panel-guide.md#who-changed-what).

## Performance budgets

Sizes are tested, not hoped for. `src/lib/budgets.ts` states the limits and
`scripts/measure.mjs` measures the built bundles after `npm run build`, writing
`src/lib/budget-report.json`; `npm run check:budgets` fails CI when a bundle grows
past its budget, and **Tools → Site Health** shows the same numbers with a bar for
each. `npm run check:assets` separately guards the panel CSS and token files.
Every budget is gzipped and excludes media, because that is what a visitor
downloads.

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
tests/panel.test.mjs       the panel itself, over HTTP
tests/origin.test.mjs      the site-name-from-domain rule
tests/template.test.mjs    the template engine, directly
docs/panel-guide.md        every admin screen
docs/theme-developer-guide.md  the manifest, tags, assets, settings
docs/panel-overhaul-roadmap.md what was built in which release
scripts/measure.mjs        performance budgets, run by npm test
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
                           appearance.css, themes.css, legacy.css)
      components.ts        pageHead, card, table, tabs, emptyState, notice, ...
      icons.ts             inline SVG sprite
      preferences.ts       colour scheme, density, rail state (per browser)
      shell.ts             route: palette search, rail/scheme/density links
      search.ts            site-wide search across content, media, comments, users
      palette.ts           command palette script and its endpoint config
      attention.ts         "needs attention" checks for the dashboard
      revisions.ts         save snapshots, line diff, autosave retention, edit locks
      editor-views.ts      revision list, diff and editor banners (server-rendered)
      editor-js.ts         the editor's client script (bar, links, images, autosave, stats)
      editor-utils.ts      its pure helpers, tested on their own (slugify, link and
                           image-figure rules, word count) - one small script
      media-picker.ts      the picker dialog and its client script (library + upload tabs)
      media-compress.ts    browser-side resize/WebP compression shared by every upload form
      assets/screens/editor.css   editor-only styles (History, banners, picker)
      assets.ts            route: GET /{admin}/assets/*.css (immutable, ETagged)
      bundles.ts           CSS bundle registry: tokens, app, screens + ETags
      content.ts           pages and posts
      media.ts             media library
      settings.ts
      menus.ts               menu editor
      themes.ts              store, preview, editor, install, zip export
      comments.ts            comment moderation and replies
      users.ts               accounts and roles
      plugins.ts             built-in plugins and code snippets
      tools.ts               redirects, import/export v2, backups, health, audit log
      updates.ts             versions, migrations, theme updates
      appearance.ts          customize (CSS/code) and footer widgets
      terms.ts               categories and tags
  node/
    server.ts              Node.js entry point (PORT, DATA_DIR, TRUST_PROXY)
    storage.ts             SQLite + disk versions of D1, KV and file storage
  db/
    schema.sql
    index.ts               schema runner
    migrations/index.ts    forward-only migrations (v3 revisions, v4 order, v5 theme assets,
                           v6 theme versions, v7 audit log)
  lib/
    auth.ts                passwords, sessions, CSRF, roles
    security.ts            escaping, sanitizer, rate limiting
    files.ts               uploaded files: KV on Cloudflare, disk on Node
    media-types.ts         accepted image/file formats and their stored Content-Type
    themes.ts, zip.ts      theme bundle reader and zip reader/writer
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
    capabilities.ts        the capability list, role defaults and can(user, cap)
    audit.ts               audit_log: one helper, filters, 90-day retention
    i18n.ts                panel strings: t(key, vars) and the en catalogue
    budgets.ts             performance limits, checked by scripts/measure.mjs
    config.ts              KV config, settings
    time.ts                timezone helpers
    ui.ts                  admin HTML helpers and CSS
  themes/
    index.ts               theme store list
    default/               AMS Base
    pro/                   AMS Pro
    premium/               AMS Premium
    journal/               AMS Journal (serif, single column)
    portfolio/             AMS Portfolio (grid, hero)
```
