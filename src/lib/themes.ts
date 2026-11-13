/**
 * Saving a theme: validation, storage and de-duplication.
 *
 * The shape of a theme (manifest, templates, partials, assets) is owned by
 * `theme-manifest.ts`; this file is the write path — it decides what a theme
 * may replace, keeps assets in step, and refuses to install a theme that would
 * break inheritance (a missing parent, a cycle).
 */
import type { Env } from '../types';
import { unzip } from './zip';
import {
  ThemeError, MAX_THEME_ASSET, MAX_THEME_UPLOAD, readThemeUpload, type ThemeManifest, type ThemeUpload, type UploadedAsset,
} from './theme-manifest';
import { hasTable } from './schema';
import { replaceThemeAssets, indexAsset, unindexAssets, listThemeAssets } from './theme-store';

export { ThemeError, MAX_THEME_UPLOAD, MAX_THEME_ASSET };
export type { ThemeManifest, UploadedAsset };

export type SaveResult = {
  /** The theme as stored. */
  slug: string;
  name: string;
  version: string;
  created: boolean;
  updated: boolean;
  assets: number;
  skipped: { path: string; reason: string }[];
  /** Settings the previous version had that this one no longer declares (kept, hidden). */
  droppedSettings: string[];
};

/** Which templates a theme replaces is answered per request; nothing is cached here. */
export async function themeExists(env: Env, slug: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS x FROM themes WHERE slug=?').bind(slug).first();
  return !!row;
}

const isCycle = async (env: Env, slug: string, parent: string | null): Promise<boolean> => {
  if (!parent) return false;
  if (parent === slug) return true;
  // Walk up the chain; a cycle back to `slug` would hang the renderer forever.
  let cursor: string | null = parent;
  for (let depth = 0; cursor && depth < 8; depth++) {
    const row: { manifest: string } | null = await env.DB.prepare('SELECT manifest FROM themes WHERE slug=?')
      .bind(cursor).first<{ manifest: string }>();
    if (!row) return false;
    try {
      cursor = (JSON.parse(row.manifest || '{}') as { parent?: string | null }).parent ?? null;
    } catch {
      return false;
    }
    if (cursor === slug) return true;
  }
  return false;
};

/**
 * Stores a theme. A theme with the same slug is replaced (its install history
 * is snapshotted by the caller before activation), and its asset set is
 * synchronised: new files written, files the new version no longer has removed.
 */
export async function saveTheme(env: Env, upload: ThemeUpload, previousAssetPaths: string[] = []): Promise<SaveResult> {
  const { manifest, templates, partials, css } = upload;
  let assets = upload.assets;
  if (manifest.parent) {
    if (!(await themeExists(env, manifest.parent))) {
      throw new ThemeError(`This theme inherits from "${manifest.parent}", which is not installed. Install the parent first.`);
    }
    if (await isCycle(env, manifest.slug, manifest.parent)) {
      throw new ThemeError('That parent theme would create an inheritance loop.');
    }
  }
  const exists = await themeExists(env, manifest.slug);
  const v2 = await hasTable(env, 'theme_assets');

  if (!v2 && assets.length) {
    throw new ThemeError('This database cannot store theme assets yet. Run updates from the Updates screen first.');
  }

  await env.DB.prepare(
    `INSERT INTO themes (slug,name,version,templates,partials,css,manifest,parent,author,description,screenshot,active,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)
     ON CONFLICT(slug) DO UPDATE SET
       name=excluded.name, version=excluded.version, templates=excluded.templates, partials=excluded.partials,
       css=excluded.css, manifest=excluded.manifest, parent=excluded.parent, author=excluded.author,
       description=excluded.description, screenshot=excluded.screenshot`,
  ).bind(
    manifest.slug, manifest.name, manifest.version,
    JSON.stringify(templates), JSON.stringify(partials), css, JSON.stringify(manifest),
    manifest.parent, manifest.author, manifest.description, manifest.screenshot,
    new Date().toISOString(),
  ).run();

  // The stylesheet is an asset too: v2 layouts link it, and a browser cache then
  // keeps it out of the HTML for every page view.
  if (v2 && css.trim()) {
    const bytes = new TextEncoder().encode(css);
    const styleAsset: UploadedAsset = { path: 'style.css', data: bytes, mime: 'text/css; charset=utf-8' };
    const withoutStyle = assets.filter((a) => a.path !== 'style.css');
    assets = [...withoutStyle, styleAsset];
  }

  if (v2) {
    await replaceThemeAssets(env, manifest.slug, assets, previousAssetPaths);
    for (const asset of assets) await indexAsset(env, manifest.slug, asset);
    const keep = new Set(assets.map((a) => a.path));
    await unindexAssets(env, manifest.slug, previousAssetPaths.filter((p) => !keep.has(p)));
  }

  const droppedSettings = await dropStaleSettings(env, manifest);
  return {
    slug: manifest.slug, name: manifest.name, version: manifest.version,
    created: !exists, updated: exists, assets: assets.length,
    skipped: upload.skipped, droppedSettings,
  };
}

/** Saved values for settings a new theme version removed are deleted, not orphaned. */
async function dropStaleSettings(env: Env, manifest: ThemeManifest): Promise<string[]> {
  if (!(await hasTable(env, 'theme_settings'))) return [];
  try {
    const { results } = await env.DB.prepare('SELECT key FROM theme_settings WHERE theme_slug=?')
      .bind(manifest.slug).all<{ key: string }>();
    const live = new Set(manifest.settings.map((s) => s.key));
    const stale = results.map((r) => r.key).filter((k) => !live.has(k));
    if (stale.length) {
      await env.DB.batch(stale.map((k) => env.DB.prepare('DELETE FROM theme_settings WHERE theme_slug=? AND key=?').bind(manifest.slug, k)));
    }
    return stale;
  } catch {
    return [];
  }
}

/** Reads an upload (JSON or zip) with the limits this app enforces. */
export function readUpload(buf: ArrayBuffer): Promise<ThemeUpload> {
  return readThemeUpload(buf, (b) => unzip(b, {
    maxEntries: 120,
    maxTotalBytes: 12 * 1024 * 1024,
    maxCompressedBytes: MAX_THEME_UPLOAD,
    maxCompressionRatio: 200,
  }));
}

/** Everything the theme manager needs to describe an installed theme. */
export async function describeTheme(env: Env, slug: string) {
  const row = await env.DB.prepare('SELECT slug, name, version, manifest FROM themes WHERE slug=?')
    .bind(slug).first<{ slug: string; name: string; version: string; manifest: string }>();
  if (!row) return null;
  let manifest: ThemeManifest | null = null;
  try {
    manifest = JSON.parse(row.manifest) as ThemeManifest;
  } catch {
    manifest = null;
  }
  return { ...row, manifest, assets: await listThemeAssets(env, slug) };
}
