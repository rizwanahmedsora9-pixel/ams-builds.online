# Official Edge CMS theme package format — version 3

This is the package contract used by the sample ZIP generator and installer. It is designed around the existing Edge CMS renderer and remains backward-compatible with legacy v1/v2 theme manifests. It does **not** use Flask or Jinja: theme templates use the CMS template syntax documented in [Theme Developer Guide](theme-developer-guide.md).

## Directory layout

A ZIP contains exactly one root directory named after its unique theme slug:

```text
ahmed-starter-theme/
├── theme.json
├── README.md
├── screenshot.png
├── templates/
│   ├── base.html
│   ├── home.html
│   ├── page.html
│   ├── post.html
│   ├── archive.html
│   ├── search.html
│   └── 404.html
├── partials/
│   ├── header.html
│   ├── navigation.html
│   └── footer.html
├── static/
│   ├── css/style.css
│   ├── js/theme.js
│   ├── images/README.md
│   └── fonts/README.md
└── config/
    ├── settings.json
    └── menus.json
```

The package reader accepts a single top-level theme directory and resolves all references relative to `theme.json`. The CSS file is declared in `css`; images, fonts, and JavaScript are declared in `assets`. Empty image/font directories are represented by their explanatory README files. Files that are documentation/configuration are not served as theme assets.

## Manifest

`theme.json` is UTF-8 JSON. The current manifest version is `3`; manifests from earlier versions continue to load with conservative defaults.

```json
{
  "manifest_version": 3,
  "name": "Ahmed Starter Theme",
  "slug": "ahmed-starter-theme",
  "version": "1.0.0",
  "author": "Ahmed",
  "description": "An editable responsive starter using existing CMS content.",
  "cms_compatibility": { "min": "0.9.0", "max": "0.9.x" },
  "preview": ["#f7f8fa", "#172033", "#2457d6"],
  "screenshot": "screenshot.png",
  "required_templates": ["base", "home", "page", "post", "archive", "404"],
  "optional_templates": ["search"],
  "features": ["menus", "page-hierarchy", "responsive-navigation"],
  "menu_locations": ["primary", "footer"],
  "templates": {
    "base": "templates/base.html",
    "home": "templates/home.html",
    "page": "templates/page.html",
    "post": "templates/post.html",
    "archive": "templates/archive.html",
    "search": "templates/search.html",
    "404": "templates/404.html"
  },
  "partials": {
    "header": "partials/header.html",
    "navigation": "partials/navigation.html",
    "footer": "partials/footer.html"
  },
  "css": "static/css/style.css",
  "asset_entrypoints": { "css": "static/css/style.css", "js": ["static/js/theme.js"] },
  "assets": ["static/js/theme.js", "screenshot.png"],
  "settings_schema": [
    { "key": "accent", "type": "color", "label": "Accent color", "default": "#2457d6" }
  ]
}
```

`settings_schema` is canonical for v3; `settings` remains accepted for v1/v2 packages. Supported setting types are `text`, `textarea`, `toggle`, `color`, `select`, `number`, `range`, `image`, and `url`. Numeric settings may declare `min`, `max`, and positive `step` bounds; range settings require both `min` and `max`. Submitted values are validated against the schema and persisted separately by theme slug. `cms_compatibility.min` is required for v3; `max` is optional. `required_templates` must exist in the package (or be inherited from its installed parent); optional templates fall back to the documented CMS template fallback. Menu locations must use supported CMS location keys.

## Assets and trust

CSS is stored as the theme stylesheet and linked through `{{{theme_css_url}}}`. Theme JS, images, fonts, and screenshots use the theme-scoped `{{asset "path"}}` helper and `/theme-assets/{slug}/{path}` URLs. Permitted extensions, per-file/total sizes, archive limits, and the no-SVG policy are enforced by the package validator. README/config files remain in the exported ZIP but are never served as executable assets.

A theme's HTML and JavaScript are trusted visitor-facing code, **not sandboxed**. Install only themes from trusted sources. A manifest or ZIP never gains permission to change CMS routes, database content, menus, media, or application files.

## Template contract

The renderer's context is assembled from existing CMS data. See [Template context](theme-developer-guide.md#template-context) for exact fields, types, and helpers. Search results, when rendered, use the existing content view contract. Missing optional templates fall back to the matching standard template; required templates are validated before install/activation. The admin panel always uses its own renderer and assets.
