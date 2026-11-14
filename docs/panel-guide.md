# Panel Guide

A tour of the admin panel: what each screen is for, and the habits that keep
content, themes and people from stepping on each other. Everything here works with
JavaScript switched off — the panel is server-rendered forms, and scripts only make
it faster.

Theme authors should read the [Theme Developer Guide](theme-developer-guide.md)
next. The plan behind the panel is in [the roadmap](panel-overhaul-roadmap.md).

## Getting around

The sidebar mirrors WordPress: Dashboard, Updates, Posts, Media, Pages,
Appearance, Plugins, Users, Tools and Settings, with a **Collapse Menu** control at
the bottom (remembered in the browser). Sub-menus appear for the section you are in.

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
  launcher from anywhere in the panel: type to search every post, page, file,
  category, tag and user you are allowed to see, or pick a command (`Add post`, `Settings`,
  `Media`…). Results are fetched as a fragment from `GET /{admin}/search?q=`; with JavaScript
  off, the same box submits to the full search page. The same query is available as a plain
  link, so search results can be bookmarked.
- **Lists** - posts and pages share one pattern: status tabs with counts, a search and filter
  toolbar, sortable columns (`aria-sort`), one bulk-action bar that activates on selection, and
  an empty state that offers the next step. Below 700 px each row becomes a card with its
  column labels, so the panel is usable on a phone without sideways scrolling.
- **Dashboard** - opens with a greeting, the site name and a **Needs attention** list: scheduled
  posts that are overdue, posts untouched for 60 days, images
  without alt text, media records with no file, pending database updates and idle author
  accounts. Items are ordered by severity, each one links to the screen that fixes it, and each
  check fails quietly if the data is not there yet. Below it: site totals, recently edited
  content and version/schema/theme at a glance.

## The editor: writing, formatting and placing images

Every post and page has one editor with two skins — **Classic** (compact, WordPress-like)
and **Modern** (wider, framed toolbar) — and two tabs, **Text** (visual) and **HTML**
(source). Both tabs edit the same document and switching keeps the caret.

**The bar.** Bold, italic, underline, strikethrough · H2/H3/H4, paragraph, bulleted and
numbered lists, quote, code, divider · Link, Media, Page break, Featured image, HTML
block, YouTube. Shortcuts work in the writing surface: `Ctrl/Cmd+S` saves,
`Ctrl/Cmd+B/I/U` formats, `Ctrl/Cmd+Shift+K` links the selection. (`Ctrl/Cmd+K` is the
command palette, so the link shortcut adds Shift.)

**Paste** brings the words and drops foreign styling — a paste from Word or a browser
arrives as plain text, and a clipboard that is only an image URL becomes an image block.
Add Shift to keep the clipboard's markup.

**Placing an image.** The Media button opens the library/upload picker; the picture you
pick opens *Place this image*: preview, alt text, caption, optional link and width.
Inserted at 50%, centred. A picture can also be pasted or dropped straight onto the
writing surface — it uploads itself and lands at the caret. Click the image in the Text
tab and a bar appears with size presets (25/50/75/100%), a width slider, plus **Alt**,
**Caption**, **Link** and **Remove**, and four corner anchors you can drag. Width and
alignment are saved with the post, so the published page matches the editor.

**Links** are a dialog — address, words, new tab — and pressing Link with the cursor in a
link edits it, words included. Anything that is not `http(s)`, `mailto`, `tel`, `#` or a
path on the site is refused before it is saved.

**Page break** inserts a labelled rule that becomes a real page break when the post is
printed; **divider** inserts a plain rule. **HTML block** and **YouTube** open a dialog
with a live error (YouTube takes watch, `youtu.be`, Shorts, live and embed URLs).

**While you write**, the bar shows the word count, reading time and characters for what a
reader will see, the slug is previewed under its field, and autosave runs every 30
seconds. On save the editor turns the browser's line `<div>`s into paragraphs and drops
empty leftovers, so the stored markup is as clean as the writing.

## Writing: safe, fast, and never a surprise

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
- **Page hierarchy and order.** In the page editor, **Parent page** nests a page under another page; the Pages screen shows the resulting tree. A parent page automatically lists its published children as linked cards, and child pages show breadcrumbs back up the tree. Keep child pages out of the header by leaving **Show in the main menu** unchecked. Page URLs stay at their existing `/<slug>` addresses when you move them, so links do not break. The *Page order* panel sets sibling order and the same ordering reaches themes through `{{#each pages}}`.
- **Page-specific posts.** In the post editor (under **Post options → Show on page(s) only**) and in *Quick edit*, tick one or more pages or sub-pages to publish a post exclusively on those selected pages. Assigned posts render as cards directly on each chosen page and remain reachable at their own post URL, while staying out of `/blog`, category/tag archives, the RSS feed, `/api/posts` and the Home page's general latest-posts feed. Leave every page unchecked for a regular blog post.
- **Fixed first-visit landing screen.** The welcome screen is built into the site and cannot be
  replaced by a CMS Page or sample content. It takes the company name from **Settings → Site title**,
  the welcome line from **Settings → Tagline**, and an optional image from **Appearance → Identity**.
  **Landing page** in the sidebar is where the screen is switched: *Show the landing page* (Yes/No)
  and *Show the play button on the landing page* (Yes/No). Turning the screen off removes the welcome
  layer completely; turning the play button off keeps the welcome copy and **Enter site** but drops
  the player, the equalizer, the mute control and the audio download. Both answers default to Yes and
  are saved together with **Save landing options**.
  The screen wears the active theme: its background, text, hairline, corner radius and body font are
  read from the theme's own stylesheet (through its `var(…)` chains), and any colour set under
  **Appearance → Colours** overrides them, so a brand colour reaches the welcome screen too. A theme
  with a light and a dark palette gets both, switched the way its own stylesheet switches (the
  browser's `prefers-color-scheme`, the site's *Colour scheme* setting, or a theme's own
  light/dark toggle); a dark theme gets a dark card with light copy and a light theme the reverse.
  Switching themes changes the screen with the rest of the site — there is nothing to restyle.
  Under **Settings → Landing soundtrack**, upload/select up to 20 audio tracks; the fixed screen has a
  centered round play/pause icon button, equalizer, mute control and Enter button. **Enter site** has
  its own row under the player, centred on the card's axis, so it stays aligned whether or not the
  mute control and footnote are there. The first track is
  preloaded while the screen is up, so pressing Play starts sound immediately. Tracks play in order and
  loop after Play is pressed. Enter stops playback and reveals the regular home page. The welcome layer stays
  dismissed in that tab until the tab is closed; **Preview** on the Landing page screen (or the link in
  Settings) reopens it via `/?landing=1`, even while the screen is switched off. Browsers require a
  visitor gesture for audible playback, so audio does not start automatically on page load.

  Soundtrack files upload one at a time as soon as you pick them, each with its own progress row, so a
  large MP3 on a slow connection cannot take the rest of the settings down with it. A file the server
  refuses (wrong type, over 20 MB) is named in place and everything else still saves. Without
  JavaScript the files travel with **Save settings** as before.
- **Preview in any theme.** `?preview=1&theme=<slug>` renders the post with any installed theme,
  for signed-in users only and never cached.

The account menu (top right) holds Profile, Preferences, colour scheme shortcuts
(light / dark / match system) and Log out. Rail state, scheme and density are also
one-click links (`/rail/collapsed`, `/scheme/dark`), so they work with JavaScript off.
A screen that fails to render shows a styled error page naming the route, instead of a
blank 500.

| Section | What it does |
| --- | --- |
| Dashboard | Greeting, **Needs attention** checklist (each item links to the fix), site totals, recently edited content, version, schema and theme |
| Updates | CMS version, database schema, pending migrations (with a button), theme updates, plugin states and the last backup |
| Posts | Shared list pattern with thumbnails and a row menu (edit, quick edit, duplicate, history, pin, preview in theme); status tabs, search, date/category filters, sortable columns, bulk publish/draft/delete, card layout on phones; add new, **Categories** and **Tags**; the full editor (formatting bar, links, images with caption/alt/link, page breaks, word count), excerpt, featured image, SEO, draft/published/scheduled |
| Media | Searchable grid/list library with type and date filters, bulk delete, copy URLs, alt-text editing and uploads (images, PDF, audio, video, fonts) to KV (Cloudflare) or `data/media/` (Node). Images are compressed to WebP in the browser before upload, in every common format (JPG/JFIF, PNG/APNG, GIF, WebP, AVIF, BMP, TIFF, HEIC, JXL, ICO, SVG). The editor's media picker uses the same library and has two tabs: **Library** and **Upload from device** |
| Pages | Same list pattern as Posts, plus a **Page hierarchy** tree, **Parent page** selector and **Page order** panel; published children become linked cards with breadcrumbs; status/date filters and bulk publish/draft/delete; a tick adds a page to the header menu |
| Appearance | **Customize** (design tokens, the theme's own settings, custom code, live preview), **Themes**, **Templates**, **Menus**, **Widgets** (the areas the theme declares), **Identity** (logo, favicon, social image) |
| Plugins | Built-in XML sitemap, robots.txt and RSS feed can be switched off; add your own snippet to `<head>` or before `</body>` |
| Users | Add, edit, re-role and delete accounts; Profile changes your own email and password |
| Tools | Redirects (301/302), JSON import/export, server-stored backups, site health, page-cache reset |
| Landing page | Two Yes/No switches: *Show the landing page* and *Show the play button on the landing page*, with a preview that works even while the screen is off |
| Settings | Site identity and favicon (the title follows the domain until you rename it), reading, the landing soundtrack (an ordered looping playlist uploaded one track at a time), domains and the admin URL |

## Who changed what

**Tools → Audit log** lists every change made in the panel — content saved, published or deleted, themes
installed, activated, edited and rolled back, settings and appearance changed, users added or re-roled,
imports and exports. Each row says **who** (name and username), **what** (a sentence
naming the object, not its id), **where** (the area), **when** (date and time in the site's timezone) and the
IP address. Newest first.

Filters are ordinary GET parameters, so a view is a link you can send to someone:

```
/tools/audit?user=3&action=deleted&type=content&q=invoice&page=2
```

`user`, `action`, `type`, `q` (free text over the summary) and `page`. Entries older than **90 days** are
deleted by the cron trigger, and the screen says so. If the table is missing — an old database that has not
been upgraded yet — the screen explains that instead of failing, and everything else keeps working.

The point is one question answered without a terminal: a client asks "who unpublished that page", and the
answer is two clicks away.

### Permissions are capabilities

Each account has a role, and each role is a bundle of capabilities:

| Capability | What it lets you do |
| --- | --- |
| `read` | open the panel at all |
| `write_posts`, `edit_own_posts`, `edit_others_posts` | write, and whose posts you may change |
| `manage_pages`, `manage_terms`, `manage_media`, `manage_menus` | pages, categories/tags, the media library, menus |
| `manage_themes`, `manage_plugins`, `manage_settings`, `manage_users`, `manage_tools`, `manage_updates` | each admin area |

The three roles keep the permissions they always had — **author** writes their own posts and media,
**editor** looks after all content, media and menus, **admin** has everything — but the check
everywhere in the code is `can(user, 'manage_pages')`, never `role === 'admin'`. The sidebar is built from
the same map, so a role never sees a link to a screen it will be refused (refused with a styled 403 that says
which capability was missing). The Users screen describes each role by asking the map, so the description
cannot drift from the behaviour. Adding a fourth role later is one entry in `src/lib/capabilities.ts`.

## Themes in the panel

**Appearance → Themes** is three screens in one:

1. **Store** — a card per bundled theme with its screenshot, author, version and tags. **Preview** opens the
   real site in an iframe with that theme loaded, before anything is installed; **Install** and
   **Install and activate** are one click each and show progress while they run. A theme you already have
   shows **Update available v1.0 → v1.2** with its changelog when the store ships a newer version.
2. **Installed** — the active theme first, then the rest. Each row opens the theme's screen: version,
   settings, a history list (**Roll back** to any snapshot), **Download** as a zip, **Delete**, and **Edit**.
3. **Authoring** — **Edit** is a file tree and a textarea: layout, each page template, each partial, the
   stylesheet. Save one file at a time; the theme is validated first and a syntax error is refused by name
   rather than saved. **New theme from a template** starts a blank theme or a child of an existing one;
   **Upload** takes a zip exported from any site.

**Appearance → Customize** is where the look is decided: brand colour and other design tokens, the active
theme's own settings (generated from the theme's manifest, so a new theme needs no code), custom code, and a
live preview. The preview goes through a signed `HttpOnly` cookie — never the URL — so a colour you have not
saved is visible to you and nobody else, and the public site is untouched until you press Save.

## Appearance: the look, live

Everything about how the site looks is under one sidebar section:

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

## Tools, import and export

| Screen | What it does |
| --- | --- |
| Redirects | path → target, 301 or 302, applied before the page cache |
| Import / Export | one JSON file (format version 2) with content, terms, menus, redirects, settings, themes with their templates and stylesheets, per-theme settings, revisions, and users without passwords |
| Backups | the same file stored server-side, downloadable, deletable |
| Site Health | database, KV, media, versions, schema, cache, content counts, whether the database is password-protected, and the performance budgets |
| Audit log | who changed what, for 90 days |
| Reset the panel | delete everything and reopen the installer - the "we built this wrong" button, under Danger zone |

Import merges by type and slug, so running the same file twice is safe. Themes in the file are validated
individually and installed; one broken theme is skipped with a warning and the rest of the file still lands.
Theme image and font assets are not in the JSON — they stay in the file store — so a restore brings back
templates and stylesheets, and the export names the assets it saw.

### Starting over: the factory reset

**Tools → Danger zone → Reset the panel** is for the site that was built wrong: a
test install, a domain entered badly, a theme imported over the top of everything,
or a panel somebody else started and left half-finished. It puts the installation
back to the moment before the installer ran, without a restart and without shell
access.

The screen is deliberately slow. It counts what it is about to destroy - pages,
posts, media files, panel accounts, themes, menus, redirects and server
backups - and lists what has no count: the audit log, every setting, the admin URL,
the secret that keeps people signed in, the cached pages and the database password.
It offers the export first, because that JSON file is the only way to get anything
back afterwards. Then it asks for two things:

1. **your panel password**, so a browser left signed in on a shared machine cannot
   wipe the site;
2. **the typed word `RESET`**, which no autofill and no restored form will produce
   by accident. With JavaScript on the submit button stays disabled until the word
   matches and a dialog asks once more; with JavaScript off the server checks both
   all the same.

Only an admin can reach it, every submission carries the CSRF token and an Origin
check, and a wrong word or a wrong password sends you back with the site intact.

What the reset does (`src/lib/reset.ts`):

- drops every CMS table, so the installer's schema runner rebuilds them from
  `schema.sql` at the current version;
- empties the runtime's own tables (`_kv`, `_files` on Node) instead of dropping
  them, because the open database handle was built around them;
- deletes the uploads - the whole media folder on Node, every stored key on
  Cloudflare, which takes the page cache and the `media:*` values with it;
- deletes the install lock and the config, and clears the two caches that would
  otherwise keep describing the old site (the schema probes and the per-isolate
  "installed" memo).

You are signed out and redirected to `/install`. From there the site is installed
again exactly as it was the first time: new admin account, site title, domain and
admin URL, one sample home page, the default theme, empty library. On Cloudflare,
key-value deletion is eventually consistent, so the installer can take a few
seconds to appear in every region.

The audit log is deleted by the reset it would have recorded. The lasting record is
a line in the server log naming who did it and how much went.

### The database password

Site Health reports it, and the environment sets it. On a Node server the database
is a SQLite file with no user list and no cipher to switch on, so protection comes
from two places: the data folder, database file and media folder are created
owner-only, and `DB_PASSWORD` locks the database to a password that every start
must present. The first start carrying it records the hash; a later start without
it exits before it listens rather than serving a database it may not open, and
`DB_PASSWORD_UNLOCK=1` is the one-start escape hatch for a password nobody has any
more. On Cloudflare the same row says the database is D1, reached only through the
Worker binding, so there is nothing to present. The README's
[*The database password*](../README.md#the-database-password) has the commands.

A factory reset clears the stored password with everything else; a server that
still has `DB_PASSWORD` in its environment locks the new database again on its next
start.

### Performance budgets

Site Health shows what this build measured against its limits: admin HTML, the three panel CSS files, the
editor script and a public page, gzipped and without media. `npm test` runs the same measurement and fails
when a bundle grows past its budget, so the number in the panel is the number CI enforced, not an estimate.

## Page icons and social profiles

In Pages, edit a page and choose a **Page icon**, then save. The Pages tree
shows the selected icon; themes can access the saved name as `pages[].icon`
(an empty name means the default). Icons do not change page URLs.

Under **Settings → Social profiles**, enter complete HTTP or HTTPS profile
URLs and enable **Show social links in the footer**. Save settings to publish
them. Blank profiles are omitted. Bundled themes render the links in their
footer; custom themes can use `site.social` (a list of `name`, `label`, and
`url` objects) and `site.social_footer` to respect the footer toggle. Existing installed
themes keep their customizations; reinstall or update a bundled theme to pick up
the new footer partial.

## Python apps in a post or page

The editor's **Python app** button embeds a single-file `.py` program that runs on the published page.

1. Click **Python app**, choose the `.py` file (or paste the code), and set the area it takes: width in percent, height in pixels.
2. The app lands in the text as one block. Click it to select it, then drag the handles: the sides and corners set the width, the bottom ones the height. The floating bar has size presets, alignment, **Edit code**, **Auto-start**, move up/down and **Remove** (or press Delete).
3. Save. On the public page the block becomes a terminal that runs the program.

What to expect:

- The program runs **in the visitor's browser** with [Pyodide](https://pyodide.org) (CPython as WebAssembly), loaded from `cdn.jsdelivr.net`. Nothing runs on your server, and the first run downloads about 10 MB.
- It runs inside a sandboxed frame (`/__pyapp/runner`) with no access to your site's cookies or panel, so authors without admin rights can use it too.
- `print()` and `input()` work as written, including `input()` inside functions, methods and `__init__`. Popular scientific packages bundled with Pyodide (numpy, pandas, matplotlib…) are fetched when imported; `plt.show()` draws the figure into the terminal.
- Desktop windows (tkinter, pygame, turtle), web servers (Flask, Django), threads and subprocesses cannot run in a web page. The dialog warns when it sees those imports.
- With **Auto-start** off, visitors get a **Run** button and nothing is downloaded until they press it. With scripts disabled, the page shows the source as a code listing.

When an app does not run, the block itself says why:

- **The editor canvas shows a card with the file name and the source, and nothing executes.** That is the editor preview, by design: a program runs only on the saved page, opened normally in a browser. Press **View** (or open the permalink) rather than judging from the canvas, and make sure the post is **published** — a draft is not served at its URL at all.
- **The published page shows the code listing instead of a terminal.** The loader did not run: check that the block is still `<figure class="python-app">` with a `<pre><code>` inside after editing in the **HTML** tab, and that the visitor has JavaScript on. A fenced Markdown code block or a plain code block is only a listing; it needs the **Python app** button.
- **The terminal says "Loading Python…" and then "Python could not be loaded".** The interpreter comes from `cdn.jsdelivr.net` on the visitor's machine, so a blocked CDN, a strict company proxy or an offline connection stops it here while the rest of the page is fine. The first run is about 12 MB (9.2 MB WebAssembly + 2.5 MB standard library); it is cached for later visits. Nothing is downloaded if **Auto-start** is off until the visitor presses **Run**.
- **The terminal says "This browser cannot run Python here".** The browser is too old for Web Workers and WebAssembly; a current Chrome, Firefox, Edge or Safari runs it.
- **The program stops with a traceback.** The line numbers are the writer's own. The usual cause is an import that a page cannot support (desktop windows, servers, threads, subprocesses) — the dialog lists those while you still have the code open.
- **Nothing at all where the block should be.** The body was saved without the figure (for example the HTML editor stripped it, or it was pasted as escaped `&lt;figure&gt;` text). Insert it again with **Python app**.
