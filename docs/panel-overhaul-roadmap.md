# Panel Overhaul, Posts Workflow & Theme Platform — Professional-Grade Roadmap

Status: proposal · Target: `0.2.0 → 1.0.0` · Owner: AMS
Scope: admin panel shell, posts/pages workflow, appearance hub, theme architecture, theme store.

---

## 1. Where the product stands today

The CMS is in unusually good shape for its size (~7,000 lines, no framework, no build step beyond
esbuild). What already works and should not be regressed:

- **Security is real**: PBKDF2 sessions, CSRF + Origin checks on every POST, rate limiting, role
  model, sanitizer for non-admin HTML, sandboxed media responses.
- **Cache story is coherent**: generation-stamped KV keys, every mutation bumps the generation.
- **Deployment story is honest**: one Worker or one Node process, D1 + KV, no vendor SDK sprawl.
- **Tests exist and are behavioural** (25 end-to-end cases across two runtimes).
- **Themes are data, never code** — the template engine cannot execute anything.

The problem is not quality, it is **ceiling**. The panel was built screen-by-screen, so every route
hand-writes its own markup against one 31 KB CSS string; and the theme system was designed as
"six templates + one CSS blob", which is a *starter* theme format, not a *theme platform*.

### Findings that hold the product back

Severity: P0 = blocks professional use · P1 = visible quality gap · P2 = polish.

#### A. Posts & pages workflow

| # | Finding | Where | Sev |
|---|---|---|---|
| A1 | No autosave, no unsaved-changes warning. Closing a tab loses a draft silently. | `routes/admin/content.ts` | P0 |
| A2 | No revisions. One bad save overwrites published prose with no recovery. | schema | P0 |
| A3 | No edit lock / conflict detection. Two editors → last write wins, no warning. | `content.post('…/save')` | P0 |
| A4 | Visual editor is `contenteditable` + `document.execCommand` (deprecated; inconsistent paste, no block model). | `EDITOR_JS` | P1 |
| A5 | Inserting an image means typing a URL (`data-ask="Image URL"`). Media library has no picker into the editor. | `EDITOR_JS`, `media.ts` | P1 |
| A6 | Featured image is a native `<select>` of 200 filenames. No thumbnail grid. | editor post fields | P1 |
| A7 | No quick edit, no duplicate, no inline title edit, no row thumbnails in Posts/Pages list. | `postListHref` table | P1 |
| A8 | No sticky posts, no page ordering (menu position is the only order, and it is menu-scoped). | schema | P1 |
| A9 | No "last edited by" / no edit history surfaced. | `content` table | P2 |
| A10 | Preview is `?preview=1` only — no "preview in another theme", no device widths. | `public.ts` | P1 |
| A11 | Scheduled posts are a filter tab, not a queue you can see at a glance with countdown. | posts list | P2 |

#### B. Theme architecture

| # | Finding | Where | Sev |
|---|---|---|---|
| B1 | A theme is `templates{}` + one `css` string, capped at **1 MB** in a **single D1 row**. No images, fonts, per-theme JS, or favicons. | `lib/themes.ts` (`MAX_BUNDLE`) | P0 |
| B2 | No template **partials/includes** and no layout inheritance. Every template repeats header/footer markup. | `lib/render.ts` | P0 |
| B3 | Conditional is truthiness only: no `==`, no filters (`{{date}}` formatting, truncate, pluralize), no `{{#each}}` index/parent. Themes cannot express dates, reading time, or "if two categories". | `TOKEN` regex in `render.ts` | P0 |
| B4 | Store themes are hard-wired by cross-import: Premium imports Pro's `page/post/archive/404` and is recompiled with them. Editing Pro silently changes Premium. | `themes/index.ts` | P1 |
| B5 | Theme CSS is **inlined into every page's `<head>`** — no cacheable asset URL, no ETag, 100 KB repeated per request. | `renderTheme` → `theme_css` | P1 |
| B6 | No preview before activate. Store cards show three colour swatches (`preview: [c1,c2,c3]`) and nothing else — it cannot look like a theme marketplace. | `routes/admin/themes.ts` | P0 |
| B7 | No theme editing in the panel. To change one line you download JSON, edit locally, re-upload. | `themes.ts` | P1 |
| B8 | Activation is not reversible: no revision history, no "revert to previous theme", no fallback if the active theme renders badly. | `activate()` | P1 |
| B9 | Upload-by-slug replacement silently discards local edits to that theme. | `saveTheme` | P1 |
| B10 | Themes table has no `author`, `description`, `screenshot`, `settings`, `site_id`. | `schema.sql` | P1 |
| B11 | Public pages ship **no CSP**; theme/custom JS runs unrestricted in the site origin. | `renderTheme` | P1 |
| B12 | `theme.json` v1 has no manifest semantics beyond file names — no slots, no parent, no supported tags, no changelog. | `themes/*/theme.json` | P2 |

#### C. Appearance / Customize

| # | Finding | Where | Sev |
|---|---|---|---|
| C1 | "Customize" is four raw code boxes. No tokens (brand colour, font, radius, width), so every visual change needs CSS knowledge. | `routes/admin/appearance.ts` | P0 |
| C2 | No live preview / no iframe preview pane. You save, then open the site in another tab. | — | P0 |
| C3 | Per-theme settings do not exist, so a theme cannot expose options ("hero on/off", "sidebar right"). | — | P0 |
| C4 | Customize, Themes, Menus, Widgets are four flat pages with no shared model of "the look of the site". | `ADMIN_SECTIONS` | P1 |
| C5 | Light/dark follows `prefers-color-scheme` only — no user override per device. | `ADMIN_CSS` | P2 |

#### D. Panel shell & design system

| # | Finding | Where | Sev |
|---|---|---|---|
| D1 | 31 KB of CSS in a TS template literal, inlined on every admin response, un-versioned. Emoji used as icons. | `lib/ui.ts` | P0 |
| D2 | No component layer. `content.ts` is 1,269 lines: list state, SQL, markup and inline JS per screen. Adding a field means editing three places. | `content.ts` | P0 |
| D3 | No global search. Finding a post means Posts → type → filter tabs. | — | P1 |
| D4 | No breadcrumbs, no consistent page header (title + primary action + tabs are re-invented per screen). | all routes | P1 |
| D5 | Lists are wide tables with `min-width:44rem` and horizontal scroll on mobile; no responsive card fallback. | `posts-table` | P1 |
| D6 | No audit log. Nobody can answer "who unpublished the pricing page". | — | P1 |
| D7 | No keyboard shortcuts, no command palette, no focus management on dialogs. | — | P2 |
| D8 | No per-user preferences (rows per page, editor skin is device-local only via `localStorage`). | `EDITOR_JS` | P2 |
| D9 | Dashboard is counts + two lists. No "needs attention" queue (stale drafts, scheduled today, broken links, pending comments, update available). | `admin/index.ts` | P1 |
| D10 | No empty states/onboarding path for a brand-new install. | — | P2 |

---

## 2. Principles for the overhaul

1. **The panel is a product, not a set of forms.** One design system, one component kit, one page-header
   pattern. No route renders raw markup primitives again.
2. **Nothing is lost.** Autosave + revisions + locks before any new surface ships.
3. **Themes are a platform.** Assets, partials, filters, settings schema, preview, versions, rollback.
4. **Progressive enhancement stays.** Every screen must work with JS off, as today.
5. **Editors never write CSS to get a decent result.** Tokens first, CSS as the escape hatch.
6. **Every phase ships behind tests** and bumps `APP_VERSION`; migrations are forward-only.

---

## 3. Phases

Estimates assume one senior engineer familiar with the codebase. `d` = focused working days.

### Phase 0 — Safety net & design foundations (4 d)

*Why first: everything else lands on top of these, and phases 1–6 are unsafe without tests.*

- Extract `src/admin/` UI kit: `ui/components.ts` (`pageHeader`, `card`, `table`, `tabs`, `badge`,
  `emptyState`, `modal`, `field`, `notice`, `pagination`, `toast`) rendering `html` tagged templates.
- Move `ADMIN_CSS` → `src/admin/assets/app.css`, served at `/{admin}/assets/app.css` with
  `Cache-Control: public, max-age=31536000, immutable` + `?v=APP_VERSION`. Admin HTML drops ~31 KB/page.
- Replace emoji nav icons with an inline SVG sprite (`<symbol>` set, 24 px grid).
- Design tokens (OKLCH, light + dark), spacing/radius/shadow scales, `[data-density="compact"]`.
- Theme scheme override: `data-scheme="light|dark|auto"` cookie, not just media query.
- **Error boundary**: wrap admin routes; a render failure shows a styled error card with the route,
  not a blank 500.
- Test harness: `tests/helpers.mjs` (login, install, form post, follow redirects) so later phases
  write 5-line tests instead of 40-line setups. Add `npm run test:watch`.

**Acceptance:** no admin CSS inline; every existing test green; one shared `pageHeader` used by ≥3 screens.

### Phase 1 — Panel shell overhaul (7 d)

- **App shell v2**: persistent rail (collapsible, remembers state in a cookie so the server can render
  the right width — no layout flash), sticky page header, breadcrumbs, user menu (profile / preferences
  / log out), "View site" always visible.
- **Command palette** (`Ctrl/⌘+K`): jump to any screen, search posts/pages/media/users by title as you
  type, `/new post`, `/settings`, recent items. Server-backed `GET /{admin}/search?q=` returning
  grouped JSON; palette renders it. This alone removes most navigational friction.
- **List table component**: server-rendered table + responsive card mode, column visibility, per-user
  rows-per-page preference, sticky header, bulk-action bar that appears on selection (replaces the
  duplicated top/bottom selects in `postsList`).
- **Dashboard v2 — "Needs attention"**: pending comments, posts scheduled in the next 7 days, drafts
  untouched for 30 days, theme update available, schema migration pending, last backup age, failed
  logins in 24 h. Each row links directly to the fix.
- **Empty states & onboarding**: fresh install gets a 3-step checklist (site details → pick a theme →
  write first post) that disappears when done.
- **A11y pass**: focus trap in dialogs, `aria-live` on toasts, visible focus rings, contrast ≥ 4.5:1
  in both schemes, reduced-motion support, skip-to-content in the admin.
- **Toast/flash v2**: reusable dismissible toast region; keep `?ok=`/`?err=` redirects as the no-JS path.

**Acceptance:** palette finds any post in < 2 keystrokes after the query; posts list usable at 360 px;
Lighthouse a11y ≥ 95 on dashboard and posts list; admin HTML payload down ≥ 60 %.

### Phase 2 — Posts & pages workflow (11 d)

The heart of the request. Order matters: durability first, then speed.

1. **Revisions (P0)** — migration 3:
   `content_revisions(id, content_id, title, body, excerpt, seo_*, status, author_id, created_at, note)`.
   Snapshot on every save (and on restore). Admin screen: "Revisions" tab in the editor with a diff
   (line-based, server-rendered, no library) and **Restore**. Keep last 25 per item, prune in cron.
2. **Autosave (P0)** — `POST /{admin}/:kind/:id/autosave` every 30 s when dirty, storing into
   `content_revisions` with `note='autosave'`; the editor shows "Saved 12 s ago". New posts get an
   autosave-created draft so a crash never loses work. `beforeunload` guard + "you have a newer
   autosave, restore it?" banner.
3. **Edit lock (P0)** — `content_lock(content_id, user_id, token, heartbeat_at)`. Advisory lock shown as
   "Alice is editing this post"; takeover button for editors. Prevents silent last-write-wins.
4. **Editor v2 (P1)** — replace `document.execCommand` with a small block model:
   paragraph, H2/H3, list, quote, code, image (+caption), embed, HTML block. Paste sanitizes to blocks;
   toolbar operates on the block model; the HTML textarea remains the source of truth and the no-JS
   path. Ship it as `src/admin/assets/editor.js` (one file, no deps, < 25 KB) with the same classic/modern
   skins so nothing regresses visually.
5. **Media picker (P1)** — one dialog (`GET /{admin}/media/picker?type=image`) reusable for inline
   images, featured image (thumbnail grid, not `<select>`) and page hero. Upload straight from the
   dialog via the existing upload route. Sets `alt` while inserting.
6. **Post list v2 (P1)** — 48 px row thumbnail, status pill column, hover row actions (Edit · Quick edit ·
   Duplicate · Preview · Trash · View), **Quick edit** (title, slug, status, date, categories, tags in
   place), **Duplicate**, sticky pin, and a "Preview in theme…" menu that renders the post with any
   installed theme (`?preview=1&theme=slug`, admin-only) — this also becomes the store's preview engine.
7. **Page ordering (P1)** — `content.menu_order` (integer, drag to reorder in Pages list) and an
   `order_by` setting used by `listPages` in themes; also exposes `{{#each pages}}` nav helper.
8. **Scheduled queue (P2)** — "Scheduled" tab shows countdown and a "publish now" action.
9. **Last edited by (P2)** — `content.updated_by`, shown in the editor footer and list tooltip.

**Acceptance:** kill the browser mid-edit → content recoverable; two sessions editing → second sees the
lock; image insertion possible without leaving the editor; every new route covered by an e2e test.

### Phase 3 — Theme platform v2 (9 d)

This is the architectural change that makes "adding themes" cheap.

1. **Theme packages with assets (P0)** — migration 4:
   `theme_assets(theme_id, path, mime, size, content BLOB | r2_key)`. Public route
   `GET /theme-assets/{slug}/{path}` with long-lived immutable caching, ETag, `nosniff`, and the same
   sandbox CSP as media. Upload accepts `.zip` with `assets/**` (images, fonts, per-theme `theme.js`).
   Cap: 10 MB total per theme, 512 KB per file, allow-listed MIME (no SVG with script, no HTML).
2. **Asset helper in templates** — `{{asset "logo.png"}}` and `{{{theme_css_url}}}` replacing inline
   `{{{theme_css}}}` (keep the old tag working for one release). Themes ship
   `<link rel="stylesheet" href="/theme-assets/{slug}/style.css">` → browsers cache it and pages shrink.
3. **Template engine v2 (P0)** — grammar additions, all data-only:
   - Partials: `{{> header}}`, `{{> post-card}}` resolved from `templates['partial:header']` or
     `partials/header.html` in the zip; `{{> @theme "name"}}` for cross-theme reuse.
   - Layout inheritance: `theme.json` `"layout": "base"`, template declares `{{#block content}}`.
   - Comparisons: `{{#if post.comments_count gt 0}}`, `eq/ne/gt/gte/lt/lte/and/or/not`.
   - Filters: `{{post.date | date "d MMM yyyy"}}`, `| truncate 160`, `| strip_html`, `| slug`,
     `| json`, `| default "…"`, `| upper|lower|capitalize`, `| reading_time`, `| number_format`.
   - Loop helpers: `{{@index}}`, `{{@first}}`, `{{@last}}`, `{{#each}}` over objects.
   - `{{#each}}` limit/offset: `{{#each posts limit=3}}`.
   - Compile cache keyed by template hash; a `GET /{admin}/themes/:id/validate` endpoint reports
     unknown tags/paths/missing partials before activation.
4. **Manifest v2 (`theme.json`)** — see Appendix A. Adds `author`, `homepage`, `description`,
   `screenshot`, `tags`, `parent`, `settings[]` (typed option schema), `tokens`, `assets`, `changelog`.
   Backwards compatible: v1 manifests still load.
5. **De-duplicate store themes (P1)** — Premium stops importing Pro's templates: give it its own
   `page/post/archive/404` files (they are ~15 lines each) or declare `"parent": "ams-pro"` and inherit
   explicitly through the new layout/partial mechanism.
6. **Public CSP (P1)** — emit `Content-Security-Policy` with a per-site nonce: `script-src 'self'
   'nonce-…'`; custom JS and hook snippets get the nonce; theme JS must be a served asset. Report-only
   mode behind a setting for one release, then enforce.
7. **Theme safety** — activation writes a `theme_versions` row (snapshot of templates/css/assets) so
   "Revert" exists; `?theme=<slug>` preview; a render-time fallback to AMS Base if the active theme's
   `base` throws or renders empty, plus a "Theme failed, using AMS Base" admin banner.

**Acceptance:** a theme with an image logo, custom font, `{{> partial}}` and `{{post.date | date}}`
authored and installed purely through the panel; page HTML drops the inlined CSS; CSP enforced with zero
inline violations on all three bundled themes.

### Phase 4 — Appearance hub & live Customizer (8 d)

New information architecture, replacing four flat pages:

```
Appearance
├── Customize        (tokens → live preview → per-theme settings → advanced CSS)
├── Themes           (store · installed · upload · editor · revisions)
├── Templates        (browse the active theme's templates; per-page template override)
├── Menus            (unchanged API, new chrome, drag sorting, depth-2)
├── Widgets          (areas from theme.json, not three hard-coded footer slots)
└── Identity         (logo, favicon, social image, scheme/colour defaults)
```

1. **Global tokens** (`settings` keys → CSS custom properties injected as `:root`): brand, brand-alt,
   text, surface, background, radius scale, font family (system/rounded/serif/mono + custom stack),
   type scale, container width, scheme default. Themes consume tokens; anything unspecified falls back
   to the theme's own CSS.
2. **Per-theme settings** — `theme.json` `settings[]` describes typed fields
   (`select | toggle | color | text | range | image | richtext`). Stored as
   `theme_settings(theme_id, key, value)`; exposed to templates as `{{theme.hero_title}}`,
   `{{#if theme.show_sidebar}}`. Customizer renders the correct controls automatically — this is what
   turns "adding themes" into "adding a manifest".
3. **Live preview** — split-pane Customizer: an `<iframe src="/?preview=1&theme_customize=token">` the
   admin server renders with the *unsaved* settings passed through a signed, short-lived preview
   cookie (never query-string JSON). Debounced postMessage reload; desktop/tablet/mobile widths.
   No-JS fallback: "Open preview in new tab" using the same signed cookie.
4. **Advanced** — the existing CSS/head/footer/JS boxes move under a collapsed "Custom code" section,
   unchanged in behaviour, with a warning label.
5. **Per-item template override** — "Template" dropdown in the post/page editor listing theme templates
   (e.g. use `page-landing` for this page). `content.template` column, resolved in `resolve()`.

**Acceptance:** change brand colour in the Customizer and see it in the preview without saving; a
newly uploaded theme's manifest settings appear as controls with no code change; per-page template
override renders on the public site.

### Phase 5 — Theme store & lifecycle (6 d)

- **Storefront quality**: real screenshots (`screenshot.png` in the package, rendered via
  `/theme-assets/...`; fall back to a token-generated gradient card if absent), live "Preview" modal
  running the site in an iframe with that theme (using the Phase 2 preview engine), feature tags,
  author, version + changelog, install/update/activate in one click with progress toasts.
- **Version lifecycle**: `theme_versions` rows per install/update; "Update available v1.0 → v1.2" with
  a changelog; **Rollback** one click; if local edits exist on a slug, prompt "Keep my changes /
  Replace / Save mine as a copy".
- **Theme authoring inside the panel**: file tree + CodeMirror-free plain textarea editor (no
  dependency), per-file save, validate-on-save, "New theme from a template", export as ZIP (needs a
  minimal zip *writer* next to `lib/zip.ts`), import from store or upload.
- **Two new bundled themes** to prove the platform: one "Journal" (single column, serif, large images)
  and one "Portfolio" (grid, per-theme settings for hero + accent), both using partials, tokens, a
  per-theme asset and at least three customizer settings.

**Acceptance:** install → preview → customize → rollback performed entirely in the panel; store cards
show screenshots; zip export round-trips through upload byte-for-byte for templates/CSS.

### Phase 6 — Governance, performance, polish (7 d)

- **Audit log** (migration 5): `audit_log(id, user_id, action, object_type, object_id, summary, ip,
  created_at)` written from one helper on every mutation; viewer under Tools with filters and 90-day
  retention. Answers "who changed what" for content, themes, settings and users.
- **Capabilities instead of hard-coded roles**: `role_caps` map (`manage_themes`, `edit_others_posts`,
  `moderate_comments`, `manage_users`…), UI reads `can(user, cap)`, roles keep their current defaults.
- **Performance budgets**, enforced in CI: admin HTML ≤ 60 KB gzipped, admin CSS ≤ 25 KB, editor JS
  ≤ 30 KB, public page ≤ 45 KB excluding media, TTFB targets documented per runtime.
- **i18n readiness**: all panel strings through `t()` with an `en` catalogue (no behaviour change);
  enables a second language later without touching routes.
- **Docs**: rewrite README "Themes" into a proper *Theme Developer Guide* (manifest v2, tags, filters,
  partials, tokens, assets, settings) plus a *Panel Guide* with screenshots; `docs/` becomes the
  reference, README the front door.
- **Import/export v2**: include theme packages, theme settings and revisions in Tools export.

---

## 4. Sequencing, effort and the first slice

| Phase | Content | Days | Depends on |
|---|---|---|---|
| 0 | Safety net, design system, assets | 4 | — |
| 1 | Panel shell, palette, list tables, dashboard | 7 | 0 |
| 2 | Revisions, autosave, locks, editor v2, media picker, list v2 | 11 | 0, 1 |
| 3 | Theme platform v2 (assets, partials, filters, manifest, CSP) | 9 | 0 |
| 4 | Appearance hub, tokens, per-theme settings, live preview | 8 | 1, 3 |
| 5 | Store lifecycle, authoring, rollback, 2 new themes | 6 | 3, 4 |
| 6 | Audit log, capabilities, budgets, i18n, docs | 7 | 1–5 |
| | **Total** | **52** | |

Parallelism: Phase 3 can run alongside 1–2 (different surface area), which compresses this to ~6 weeks
for two engineers.

**Minimum lovable slice (10–12 days)** if you want visible progress fast and everything else later:

1. Phase 0 asset split + component kit (2 d)
2. A1/A2/A3 — autosave, revisions, edit lock (4 d) ← the highest-value change in the whole plan
3. C1 partial: global tokens (brand/text/radius/font) + real-time preview iframe (3 d)
4. B6 partial: screenshots + preview modal in the theme store (2 d)
5. A5 media picker (1 d)

That slice alone turns "a solid CMS" into "a CMS I would defend in a review".

---

## 5. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Theme engine v2 breaks existing uploaded themes | High | v1 manifests keep loading; old `{{{theme_css}}}` still resolves for one release; `validate` endpoint; migration test with a v1 fixture |
| Revisions multiply D1 row count/size | Medium | Cap 25 per item, prune in cron, store body diffs optional later |
| Autosave + cache churn on KV (free-plan writes) | Medium | Autosave writes D1 only; cache bumped on real save/publish only |
| CSP enforcement breaks analytics snippets | Medium | Report-only release, per-site nonce, documented allow-list, toggle in Settings |
| Editor v2 regressions in content fidelity | Medium | HTML textarea stays source of truth; round-trip fuzz tests over fixtures |
| Scope creep across 6 phases | High | Ship phase-by-phase behind `APP_VERSION` bumps; each phase independently useful |

---

## 6. Decisions needed from you

1. **Editor ambition** — block model like Phase 2.4, or keep `contenteditable` and invest the time in
   themes instead? (Recommend: block model, but after revisions/autosave/locks.)
2. **Asset storage for themes** — D1 BLOB (simple, 10 MB cap) or reuse the KV/media store (cheaper at
   scale, more moving parts)? (Recommend: media store keyed `themes/{slug}/…`, D1 only for metadata.)
3. **Bundle size discipline** — is "no dependencies beyond Hono" still a rule? Everything above is
   achievable without any; say so now and it stays a selling point.
4. **Which two new store themes** do you want as proof-of-platform (Journal, Portfolio, Agency,
   Corporate, Magazine)?

---

## Appendix A — `theme.json` v2 (proposed)

```json
{
  "name": "Journal",
  "slug": "journal",
  "version": "1.2.0",
  "author": "AMS",
  "homepage": "https://example.com/journal",
  "description": "Single-column, serif, generous whitespace. For writing.",
  "screenshot": "screenshot.png",
  "tags": ["blog", "minimal", "serif"],
  "cms": ">=1.0.0",
  "parent": null,
  "layout": "base",
  "supports": ["comments", "widgets", "tokens", "settings", "assets", "partials"],
  "preview": { "colors": ["#fdfcf8", "#1a1a1a", "#b4552d"], "screenshot": "screenshot.png" },
  "templates": {
    "base": "base.html",
    "home": "home.html",
    "post": "post.html",
    "page": "page.html",
    "archive": "archive.html",
    "404": "404.html",
    "page-landing": "page-landing.html"
  },
  "partials": { "header": "partials/header.html", "post-card": "partials/post-card.html" },
  "assets": { "style": "style.css", "script": "theme.js", "logo": "assets/logo.svg" },
  "settings": [
    { "key": "hero_title", "type": "text", "label": "Hero title", "default": "Journal" },
    { "key": "show_sidebar", "type": "toggle", "label": "Show sidebar", "default": false },
    { "key": "accent", "type": "color", "label": "Accent", "default": "#b4552d" },
    { "key": "layout", "type": "select", "label": "Archive layout", "default": "list",
      "options": [ { "value": "list", "label": "List" }, { "value": "grid", "label": "Grid" } ] }
  ],
  "changelog": [ { "version": "1.2.0", "notes": "Added landing template and sidebar option." } ]
}
```

## Appendix B — Template tags (v2 target)

| Category | Examples |
|---|---|
| Values | `{{post.title}}`, `{{{post.content}}}`, `{{site.title}}`, `{{@index}}`, `{{this}}` |
| Conditions | `{{#if x}}`, `{{#unless x}}`, `{{#if n gt 3}}`, `{{#if a and (not b)}}`, `{{else}}` |
| Loops | `{{#each posts}}`, `{{#each posts limit=3}}`, `{{#each posts}}…{{else}}No posts{{/each}}` |
| Partials | `{{> header}}`, `{{> post-card post}}`, `{{> @theme "post-card"}}` |
| Layout | `{{#block content}}…{{/block}}`, `{{#extends "base"}}` |
| Filters | `{{post.date \| date "d MMM yyyy"}}`, `{{excerpt \| truncate 160}}`, `{{n \| number_format}}` |
| Assets | `{{asset "logo.svg"}}`, `{{{theme_css_url}}}`, `{{theme.accent}}`, `{{#if theme.show_sidebar}}` |
| Meta | `{{{head}}}`, `{{{footer}}}`, `{{{comments_html}}}`, `{{body_class}}`, `{{menu.primary}}` |

Every helper is a pure function over data; the engine still cannot execute code.

## Appendix C — Migrations this plan adds

| Version | Name | Objects |
|---|---|---|
| 3 | Revisions & workflow | `content_revisions`, `content_lock`, `content.menu_order`, `content.template`, `content.updated_by` |
| 4 | Theme platform | `theme_assets`, `theme_settings`, `theme_versions`, `themes.site_id/author/description/screenshot/manifest` |
| 5 | Governance | `audit_log`, `role_caps`, `user_prefs` |

Forward-only, each applied by the existing `migrate()` and surfaced on the Updates screen.

## Appendix D — Definition of done (every phase)

- [ ] Works with JavaScript disabled (server-rendered path intact)
- [ ] Keyboard operable, focus visible, `aria` labels on every control
- [ ] Light and dark, 360 px → 1920 px
- [ ] e2e coverage for each new route and each destructive action's confirmation
- [ ] `APP_VERSION` bumped, README/docs updated in the same commit
- [ ] No new runtime dependency; bundle budget met
- [ ] Migration + rollback path documented
