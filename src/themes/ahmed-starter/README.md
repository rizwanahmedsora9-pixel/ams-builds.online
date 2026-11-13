# Ahmed Starter Theme

A working starter for Edge CMS. It renders the CMS's existing pages, posts, navigation menus, site identity, featured media, comments, and theme settings. It does not create fake content or require edits to CMS core files.

## Edit and install

1. Download the sample ZIP from **Appearance → Themes → Download sample theme ZIP**.
2. Extract the `ahmed-starter-theme/` directory.
3. Edit templates in `templates/`, reusable fragments in `partials/`, styling in `static/css/style.css`, and the optional browser script in `static/js/theme.js`.
4. Change the theme `name`, unique `slug`, version, or settings schema as needed in `theme.json` and `config/settings.json`.
5. Repackage the single `ahmed-starter-theme/` directory as a ZIP, keeping its root folder intact.
6. In **Appearance → Themes**, upload the ZIP, review validation, preview it, then activate it when ready.

Themes are trusted visitor-facing code. Install packages only from sources you trust. The renderer does not run Python or server-side JavaScript, but theme HTML and browser JavaScript are not a security sandbox.

## Package map

- `theme.json`: version 3 manifest; template paths, required templates, compatibility, supported CMS menu locations, settings schema, and asset entrypoints.
- `templates/`: `base.html` is the layout; `home.html`, `page.html`, `post.html`, `archive.html`, `search.html`, and `404.html` render CMS routes.
- `partials/`: shared header, navigation, and footer fragments.
- `static/css/style.css`: responsive, theme-scoped stylesheet.
- `static/js/theme.js`: small accessible mobile navigation example; no dependencies.
- `static/images/` and `static/fonts/`: add PNG/JPEG/WebP/AVIF/ICO images and WOFF/WOFF2/TTF/OTF fonts here. SVG, HTML, and server-side executable files are rejected.
- `config/settings.json`: dynamic Customizer controls, persisted separately for each theme.
- `config/menus.json`: menu locations the theme supports. Existing CMS menus remain owned by the CMS.
- `screenshot.png`: actual package preview art, shown by the theme manager after installation.

## Template syntax and data

This is the Edge CMS template language, not Jinja. Consult the Theme Developer Guide for escaping, helpers, loops, partials, inheritance, and the exact public context. Common values include `site.title`, `site.tagline`, `site.logo`, `menu.primary`, `menu.footer`, `pages`, `page.title`, `page.content`, `post.title`, `post.content`, `posts`, `archive.title`, `search.query`, `pagination.next`, and `theme.accent`. Triple braces are only for trusted CMS-generated/content HTML, for example `{{{page.content}}}` and `{{{comments_html}}}`. Ordinary values are HTML-escaped.

Assets must use the `asset` helper, for example `{{asset "static/images/example.png"}}`. The CMS serves them under a URL unique to this theme. The active theme's CSS is linked with `{{{theme_css_url}}}`.

## Theme settings

The included controls are examples. Add controls to `config/settings.json`; supported types are text, textarea, toggle, color, select, number, image, and URL. The CMS validates settings and stores values by theme slug, so switching themes does not overwrite another theme's customization.

## Menus and page hierarchy

Menus are created and edited in the CMS Menus screen. This starter declares `primary` and `footer`, then renders the corresponding `menu.primary` and `menu.footer` arrays. Menu links and page records stay in the CMS. Parent/child page links and breadcrumbs supported by the CMS are rendered by the public rendering layer without moving page data into the theme.
