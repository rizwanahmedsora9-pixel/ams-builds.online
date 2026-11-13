# Theme Developer Guide

Everything a theme can contain, how a package is put together, what a template can
say, and what the CMS guarantees about assets, settings and the Content-Security-Policy.

The short version: a theme is `theme.json` plus the HTML it names. Templates are
plain files, partials are files too, the stylesheet is served as an asset rather
than inlined, and every helper is a pure function over data the CMS supplies — no
template can execute code.

Read this alongside the two themes in `src/themes/journal/` and
`src/themes/portfolio/`, which are small, complete examples of everything below.
The panel itself is described in the [Panel Guide](panel-guide.md); the plan that
built this is in [the roadmap](panel-overhaul-roadmap.md).

## What a theme package is

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
anything else falls back to AMS 1 (the bundled default theme). `partials/header.html` is picked up without being declared, and
everything under `assets/` is stored as a theme asset.

**Limits:** 6 MB upload, 512 KB per asset, 80 assets, PNG/JPEG/GIF/WebP/AVIF/ICO, WOFF/WOFF2/TTF/OTF and a
`theme.js`. **SVG and HTML are refused on purpose** — they can carry script, and theme assets are served
from your own origin.

## Assets are files, not inline text

The stylesheet and every other asset is served from `/theme-assets/{slug}/{path}` with a one-year immutable
cache, an ETag and `nosniff`. That is why pages are small: the CSS is downloaded once per visitor, not
shipped in every page view. In a layout:

```html
{{#if theme_css_url}}<link rel="stylesheet" href="{{{theme_css_url}}}">{{/if}}
<img src="{{asset "assets/logo.png"}}" alt="Logo">
<script defer src="{{asset "theme.js"}}"></script>
```

`{{{theme_css}}}` still renders the same CSS inline for themes that have not moved over yet.

## Template tags

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
| `home` | `page` (the chosen home page, may be empty), `posts` (latest five), `page_posts` (posts assigned exclusively to the home page) |
| `page` | `page.title`, `{{{page.content}}}`, `posts` / `page_posts` (posts assigned to this page; rendered automatically as cards when the template does not reference `posts` or `page_posts`) |
| `post` | `post.title`, `{{{post.content}}}`, `post.date`, `post.date_iso`, `post.author`, `post.featured_image`, `post.featured_alt`, `post.categories` and `post.tags` (lists of `name`, `url`), `post.pages` (assigned pages), `{{{comments_html}}}`, `comments_count`, `comments_open` |
| `archive` | `archive.title`, `posts`, `pagination.prev`, `pagination.next` |
| each item of `posts` | `title`, `url`, `excerpt`, `date`, `date_iso`, `featured_image`, `featured_alt` |

## Settings, history and previews

- **Theme settings** a theme declares are editable in the Customizer (**Appearance → Customize**) and under
  **Themes → (your theme)** — the same values, two doors — and available in
  templates as `{{theme.key}}`. Defaults come from the manifest; changes are stored per theme and
  **Reset to defaults** throws them away.
- **History** — every install, update, panel save and activation writes a `theme_versions` row, so the theme
  screen can list the history newest-first and **Roll back** to any of it. A rollback snapshots the version it
  replaces, so reverting is itself revertible; ten snapshots are kept per theme.
- **Preview** any installed theme at `/?preview=1&theme=slug` while signed in (never cached, never public).
  The store's **Preview** button uses the same engine before a theme is installed at all.
- **Screenshots** — ship `screenshot.png` in the package (declared as `screenshot` in `theme.json`, or the
  file of that name at the root). The store card shows it through `/theme-assets/<slug>/screenshot.png` once
  the theme is installed, and a palette gradient when a theme ships none. About 1200×800 is a good size.
- **Export and import** — **Download** on the theme screen produces a zip: `theme.json` naming each file,
  the templates, `partials/*.html`, `style.css` and the assets, byte-for-byte. Upload it again and the
  templates and stylesheet come back identical. `download.json` is the same theme as one JSON file.
- **Local edits vs the store** — if you edit a theme in the panel that the store also ships, the store shows
  **Update available vX → vY** with the changelog, and asks whether to keep your changes, replace them with
  the store version, or save yours as a copy under a new slug.
- **A theme that throws** while rendering cannot take the site down: the page falls back to AMS 1 (the bundled default theme) and
  the Themes screen says which theme failed and why.
- Themes contain markup, so only install themes you trust.

## Editing a theme without a terminal

**Appearance → Themes → Edit** gives you a file tree (layout, each page template, each partial, the
stylesheet) and a plain textarea with a save button — no build step, no dependencies, works without
JavaScript. Saving is validated first: an unknown filter, a partial that does not exist, an unbalanced block
or a template without a content slot is refused by name and the file is left alone. Every save is snapshotted
before it lands, so a bad save is one **Roll back** away.

**New theme from a template** creates either a blank theme (a minimal layout, home, page and post template
plus a stylesheet) or a child of an existing theme that inherits its templates through `parent`.

## Content-Security-Policy

The site sends a policy on every page: scripts only from your own site plus inline code carrying that
page's nonce, images from anywhere over HTTPS, and no plugins or objects. Your own custom CSS/JavaScript and
snippet hooks are stamped with the nonce automatically, and a theme's script is a served file, so both keep
working. Set it under **Settings → Content security policy**: *Report only* (default — the browser logs
what would be blocked and blocks nothing), *Enforce*, or *Off*. Start on report-only for a day, then enforce.
