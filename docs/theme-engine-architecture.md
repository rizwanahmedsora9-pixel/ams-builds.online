# Theme engine architecture (Phase 2)

This architecture extends the existing Edge CMS theme system; it does not introduce Flask, Jinja, a second file store, a replacement admin renderer, or a parallel registry.

## Ownership boundaries

- **CMS core** owns routes, authentication, permissions, content, media, menus, settings, and deployment bindings. Existing content URLs and records remain authoritative.
- **Theme registry and installed theme data** use the existing `themes` table. The `active` column identifies the selected installed theme. The app ships no themes, so a site with no usable active row renders the internal blank bundle (`src/themes/blank.ts`): bare, unstyled HTML that is never listed, installed or stored.
- **Package installation** is handled by `src/lib/themes.ts`, `src/lib/theme-manifest.ts`, and `src/lib/zip.ts`. Uploads are parsed and validated in memory before being persisted; they are not extracted into application directories.
- **Theme templates and CSS** are stored in the theme database row and rendered by `src/lib/template.ts` through `src/lib/render.ts`. The admin UI continues to use `src/lib/ui.ts` and `src/admin/assets/`, never the public theme loader.
- **Theme assets** are keyed by theme slug in the existing file store and served at `/theme-assets/{slug}/{path}`: only files that are actually stored, so a slug that is not installed is a 404. On Cloudflare that uses the current file/KV abstraction; on Node it uses the configured data directory.
- **Theme customization** uses the existing `theme_settings` table, keyed by theme slug and setting name. Defaults are read from that theme's manifest; saving or switching themes does not transfer values between themes.
- **CMS menus** remain in `menus` and `menu_items`. The existing menu `location` is the assignment; themes declare the locations they display and access them through the renderer's existing `menu` object.
- **Preview and activation** use the public renderer with an explicit theme bundle for the current request. Preview must remain authenticated and must not update the persisted active row. Activation is a controlled database update with a prior version snapshot and cache invalidation.
- **Fallback and recovery** remain centralized in `activeThemeFor` and `renderTheme`; the blank bundle is the safe public rendering fallback, and it needs no files served — it has no stylesheet, no script and no assets. Theme failures are surfaced to theme administrators.

## Existing interfaces reused

The current implementation already provides equivalents of theme discovery/listing, manifest inspection, package validation, installation, uninstall, active-theme lookup, activation, settings read/write, template resolution, asset URL generation, preview rendering, and version snapshots. New work should extend these functions and routes rather than introduce duplicate services.

## Runtime context contract

The stable template context is documented in [Theme Developer Guide](theme-developer-guide.md#template-context). It is assembled from existing CMS records in `src/lib/render.ts` and route resolution in `src/routes/public.ts`. Templates use the CMS's documented `{{...}}` syntax; they are not Jinja templates. Raw HTML blocks are explicitly marked with triple braces and must be treated as trusted theme code.

## Persistence and migration policy

The active theme and installed themes are already persistent in D1/SQLite. Per-theme setting values, asset indexes, and rollback snapshots already have dedicated tables. This architecture does not require a new filesystem layout or registry file. Any future schema change must be additive, forward-only, and preserve current records; do not rewrite `schema.sql` history or alter existing content/menu tables without a demonstrated need.

## Trust boundary

Theme templates contain HTML and may reference JavaScript assets. Uploaded themes are **trusted code**, not sandboxed plugins. Only users with `manage_themes` can install, edit, activate, or remove them. The custom template engine does not execute server-side JavaScript or Jinja/Python, but theme HTML/JS still affects visitor-facing output. ZIP parsing must reject unsafe or ambiguous archives before any persistent write.
