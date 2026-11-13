/**
 * Theme storage, versioning and rendering glue.
 *
 * Rows live in `themes`; a theme's binary assets live in the file store under
 * `themes/{slug}/{path}` (KV on Cloudflare, data/media/ on Node) so the same
 * code path serves them as media. Every activation writes a `theme_versions`
 * snapshot first, which is what makes "Revert" possible.
 */
import type { Env } from '../types';
import type { Settings } from './config';
import { putFile, deleteFile, getFile } from './files';
import { hasTable } from './schema';
import { render, type RenderHooks, type Scope } from './template';
import {
  DEFAULT_WIDGET_AREAS, MAX_ASSETS_PER_THEME, inherit, resolveSettings,
  type ThemeBundle, type ThemeManifest, type UploadedAsset,
} from './theme-manifest';

type ThemeRow = {
  id: number; slug: string; name: string; version: string;
  templates: string; partials?: string; css: string; manifest?: string; active: number; created_at: string;
};

const assetKey = (slug: string, path: string): string => `themes/${slug}/${path}`;

/** True once migration 5 ran: partials, manifest and page-settings columns exist. */
export async function hasThemeV2(env: Env): Promise<boolean> {
  return (await hasTable(env, 'themes')) && (await hasThemeColumns(env));
}

let columnsChecked: WeakMap<object, boolean> = new WeakMap();
async function hasThemeColumns(env: Env): Promise<boolean> {
  const hit = columnsChecked.get(env);
  if (hit !== undefined) return hit;
  try {
    const res = await env.DB.prepare('PRAGMA table_info(themes)').all<{ name: string }>();
    const names = new Set(res.results.map((r) => r.name));
    const ok = names.has('partials') && names.has('manifest');
    if (ok) columnsChecked.set(env, true);
    return ok;
  } catch {
    return false;
  }
}

function toBundle(row: ThemeRow): ThemeBundle {
  const templates = JSON.parse(row.templates || '{}') as Record<string, string>;
  let partials: Record<string, string> = {};
  try {
    partials = JSON.parse(row.partials || '{}') as Record<string, string>;
  } catch {
    /* an old row written before partials existed */
  }
  let manifest: ThemeManifest;
  try {
    manifest = JSON.parse(row.manifest || '{}') as ThemeManifest;
  } catch {
    manifest = {} as ThemeManifest;
  }
  const base: ThemeManifest = {
    name: row.name, slug: row.slug, version: row.version,
    author: '', authorUrl: '', homepage: '', description: '', parent: null,
    layout: 'base', tags: [], supports: [], screenshot: '', preview: [],
    settings: [], settings_schema: [], widgets: DEFAULT_WIDGET_AREAS, changelog: [], assets: [],
    cms_compatibility: { min: '0.0.0' }, required_templates: ['base'], optional_templates: [], features: [],
    menu_locations: ['primary', 'footer'], asset_entrypoints: { css: '', js: [] }, manifest_version: 2,
  };
  return {
    name: row.name, slug: row.slug, version: row.version,
    templates, partials, css: row.css,
    manifest: { ...base, ...manifest },
  };
}

export type StoredTheme = ThemeBundle & { id: number; active: boolean; updatedAt: string };

export async function listThemes(env: Env): Promise<StoredTheme[]> {
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, slug, name, version, templates, partials, css, manifest, active, created_at FROM themes ORDER BY active DESC, name',
    ).all<ThemeRow>();
    return results.map((row) => ({ ...toBundle(row), id: row.id, active: !!row.active, updatedAt: row.created_at }));
  } catch {
    return [];
  }
}

/** One installed theme, already merged with its parent. */
export async function loadTheme(env: Env, where: { slug?: string; id?: number }): Promise<StoredTheme | null> {
  const clause = where.id !== undefined ? 'id=?' : 'slug=?';
  const arg = where.id !== undefined ? where.id : where.slug!;
  let row: ThemeRow | null;
  try {
    row = await env.DB.prepare(
      `SELECT id, slug, name, version, templates, partials, css, manifest, active, created_at FROM themes WHERE ${clause} LIMIT 1`,
    ).bind(arg).first<ThemeRow>();
  } catch {
    row = null;
  }
  if (!row) return null;
  let bundle = toBundle(row);
  if (bundle.manifest.parent) {
    const parent = await loadThemeRaw(env, bundle.manifest.parent);
    if (parent) bundle = inherit(bundle, parent);
  }
  return { ...bundle, id: row.id, active: !!row.active, updatedAt: row.created_at };
}

/** The parent lookup must not recurse further than one level of inheritance. */
async function loadThemeRaw(env: Env, slug: string): Promise<ThemeBundle | null> {
  try {
    const row = await env.DB.prepare(
      'SELECT id, slug, name, version, templates, partials, css, manifest, active, created_at FROM themes WHERE slug=? LIMIT 1',
    ).bind(slug).first<ThemeRow>();
    return row ? toBundle(row) : null;
  } catch {
    return null;
  }
}

/** Writes a theme's assets to the file store, replacing what was there. */
export async function saveAssets(env: Env, slug: string, assets: UploadedAsset[], removed: string[] = []): Promise<void> {
  for (const path of removed) await deleteFile(env, assetKey(slug, path));
  for (const asset of assets) {
    await putFile(env, assetKey(slug, asset.path), asset.data.slice().buffer as ArrayBuffer, asset.mime);
  }
}

export async function replaceThemeAssets(env: Env, slug: string, assets: UploadedAsset[], previous: string[]): Promise<void> {
  const keep = new Set(assets.map((a) => a.path));
  await saveAssets(env, slug, assets, previous.filter((p) => !keep.has(p)));
}

export async function putThemeAsset(env: Env, slug: string, path: string, data: ArrayBuffer, mime: string): Promise<void> {
  await putFile(env, assetKey(slug, path), data, mime);
}

export async function getThemeAsset(env: Env, slug: string, path: string) {
  return getFile(env, assetKey(slug, path));
}

export async function listThemeAssets(env: Env, slug: string): Promise<{ path: string; size: number; mime: string }[]> {
  try {
    const { results } = await env.DB.prepare(
      'SELECT path, size, mime FROM theme_assets WHERE theme_slug=? ORDER BY path',
    ).bind(slug).all<{ path: string; size: number; mime: string }>();
    return results;
  } catch {
    return [];
  }
}

/** Records an asset in the index table (used for the manager screen and size caps). */
export async function indexAsset(env: Env, slug: string, asset: UploadedAsset): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO theme_assets (theme_slug, path, mime, size, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(theme_slug, path) DO UPDATE SET mime=excluded.mime, size=excluded.size`,
    ).bind(slug, asset.path, asset.mime, asset.data.byteLength, new Date().toISOString()).run();
  } catch {
    /* the index is bookkeeping; the file store is the source of truth */
  }
}

export async function unindexAssets(env: Env, slug: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    await env.DB.batch(paths.map((p) => env.DB.prepare('DELETE FROM theme_assets WHERE theme_slug=? AND path=?').bind(slug, p)));
  } catch {
    /* bookkeeping only */
  }
}

export async function assetCount(env: Env, slug: string): Promise<number> {
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM theme_assets WHERE theme_slug=?').bind(slug).first<{ n: number }>();
    return Number(row?.n || 0);
  } catch {
    return 0;
  }
}

export const assetLimitReached = (n: number): boolean => n >= MAX_ASSETS_PER_THEME;

/* ---------------------------------------------------------------- versions */

export type ThemeVersionRow = { id: number; theme_slug: string; version: string; name: string; note: string; author_id: number | null; created_at: string; author?: string | null };

/** Snapshots a theme before it changes, so the change can be undone. */
export async function recordThemeVersion(env: Env, theme: StoredTheme, opts: { note: string; authorId?: number | null }): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO theme_versions (theme_slug, version, name, templates, partials, css, manifest, assets, note, author_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      theme.slug, theme.version, theme.name,
      JSON.stringify(theme.templates), JSON.stringify(theme.partials ?? {}), theme.css,
      JSON.stringify(theme.manifest), JSON.stringify(theme.manifest.assets ?? []),
      opts.note, opts.authorId ?? null, new Date().toISOString(),
    ).run();
    // Keep the 10 most recent snapshots per theme.
    await env.DB.prepare(
      `DELETE FROM theme_versions WHERE theme_slug=? AND id NOT IN
       (SELECT id FROM theme_versions WHERE theme_slug=? ORDER BY id DESC LIMIT 10)`,
    ).bind(theme.slug, theme.slug).run();
  } catch {
    /* version history is a safety net, never a reason for a failed activation */
  }
}

export async function listThemeVersions(env: Env, slug: string): Promise<ThemeVersionRow[]> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT v.id, v.theme_slug, v.version, v.name, v.note, v.author_id, v.created_at, u.username AS author
       FROM theme_versions v LEFT JOIN users u ON u.id=v.author_id WHERE v.theme_slug=? ORDER BY v.id DESC LIMIT 20`,
    ).bind(slug).all<ThemeVersionRow>();
    return results;
  } catch {
    return [];
  }
}

export async function restoreThemeVersion(env: Env, slug: string, versionId: number): Promise<boolean> {
  try {
    const row = await env.DB.prepare('SELECT * FROM theme_versions WHERE id=? AND theme_slug=?')
      .bind(versionId, slug).first<Record<string, string>>();
    if (!row) return false;
    await env.DB.prepare(
      'UPDATE themes SET version=?, name=?, templates=?, partials=?, css=?, manifest=? WHERE slug=?',
    ).bind(row.version, row.name, row.templates, row.partials ?? '{}', row.css, row.manifest, slug).run();
    return true;
  } catch {
    return false;
  }
}

/**
 * Template names the active theme offers, for the editor's Template dropdown
 * and the Templates screen. The layout is excluded: it is a wrapper, not
 * something a page can be rendered with.
 */
export async function activeThemeTemplates(env: Env): Promise<{ slug: string; name: string; templates: string[] }> {
  const theme = await activeThemeFor(env);
  const skip = new Set(['base', theme.manifest.layout || 'base']);
  return { slug: theme.slug, name: theme.name, templates: Object.keys(theme.templates).filter((t) => !skip.has(t)).sort(sortTemplates) };
}

/** The layout name too, so the Templates screen can explain what wraps a page. */
export async function activeLayoutName(env: Env): Promise<string> {
  return (await activeThemeFor(env)).manifest.layout || 'base';
}

/** Standard templates first, then anything custom, alphabetically. */
const ORDER = ['home', 'page', 'post', 'archive', '404'];
function sortTemplates(a: string, b: string): number {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.localeCompare(b);
}

/**
 * The active theme, or the bundled one. This lives here (rather than in
 * render.ts) so the panel and the renderer share one definition.
 */
export async function activeThemeFor(env: Env): Promise<ThemeBundle> {
  const { defaultTheme } = await import('../themes/nova');
  try {
    const hit = await env.DB.prepare('SELECT slug FROM themes WHERE active=1 LIMIT 1').first<{ slug: string }>();
    if (hit) {
      const theme = await loadTheme(env, { slug: hit.slug });
      if (theme && (theme.templates.base || theme.manifest.parent)) return theme;
    }
  } catch {
    /* no themes table yet: the bundled theme */
  }
  return defaultTheme;
}

/* ------------------------------------------------------------------ render */

/**
 * Renders a theme template with the v2 engine, resolving partials and asset
 * URLs from the theme itself. The layout step (a template wrapped in its
 * `{{#block content}}` layout) is handled by the caller.
 */
export function renderWithTheme(
  theme: ThemeBundle,
  source: string,
  data: Scope,
  opts: {
    settings: Settings;
    assetUrl: (path: string) => string;
    themeSettings?: Record<string, string>;
    extraPartials?: Record<string, string>;
  },
): string {
  const values = opts.themeSettings ?? resolveSettings(theme.manifest, null);
  const hooks: RenderHooks = {
    partial: (name, _scope, crossTheme) => {
      const table = crossTheme ? (theme.manifest.parent ? theme.partials : theme.partials) : theme.partials;
      const hit = table[name] ?? opts.extraPartials?.[name];
      return hit ?? null;
    },
    asset: (path) => opts.assetUrl(path),
    themeSettings: values,
  };
  const scope: Scope = {
    ...data,
    tz: opts.settings.timezone || 'UTC',
    theme: { ...values, name: theme.name, slug: theme.slug, version: theme.version },
    __asset: opts.assetUrl,
  };
  return render(source, scope, hooks);
}

/** Public URL of a theme asset. Immutable, so it is safe to cache forever. */
export function themeAssetUrl(slug: string, path: string): string {
  return `/theme-assets/${encodeURIComponent(slug)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Wraps a rendered page in its layout. A template may declare its own layout
 * with `{{#block content}}`; otherwise the theme's `layout` (usually base) does,
 * and `{{{content}}}` remains supported for v1 themes.
 */
export function applyLayout(
  theme: ThemeBundle,
  templateName: string,
  inner: string,
  data: Scope,
  opts: Parameters<typeof renderWithTheme>[3],
): string {
  const layoutName = theme.manifest.layout || 'base';
  const layout = theme.templates[layoutName] ?? theme.templates.base;
  if (!layout) return inner;
  const withContent = { ...data, content: inner, block: { content: inner } };
  // A v1 layout uses {{{content}}}; a v2 layout uses {{#block content}}. Both
  // work because `content` and `block.content` carry the same value.
  return renderWithTheme(theme, layout, withContent, opts);
}
