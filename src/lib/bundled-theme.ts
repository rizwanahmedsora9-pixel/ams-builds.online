/**
 * The bundled default theme as stored data: writing its files to the file
 * store, answering for them when the store has no copy, and (re)installing it.
 *
 * The theme itself lives in src/themes/; this is the glue the installer, the
 * asset route and the "default theme" migration share, so they cannot drift.
 */
import type { Env } from '../types';
import { defaultTheme, defaultThemeFiles, type PackageFile } from '../themes/default';
import { putFile, deleteFile } from './files';

const CSS_MIME = 'text/css; charset=utf-8';

/** Every served file of the default theme: its stylesheet, script and screenshot. */
export function defaultThemeAssets(): PackageFile[] {
  return [
    { path: 'style.css', data: new TextEncoder().encode(defaultTheme.css), mime: CSS_MIME },
    ...defaultThemeFiles,
  ];
}

/**
 * A file of the bundled theme, straight from the app. The asset route falls
 * back to this, so the default theme is never missing its stylesheet or script
 * — not before it is installed, and not when it is the render fallback.
 */
export function bundledThemeAsset(slug: string, path: string): PackageFile | null {
  if (slug !== defaultTheme.slug) return null;
  return defaultThemeAssets().find((file) => file.path === path) ?? null;
}

/** Writes the default theme's files to the file store. */
export async function writeDefaultThemeFiles(env: Env): Promise<PackageFile[]> {
  const files = defaultThemeAssets();
  for (const file of files) {
    await putFile(env, `themes/${defaultTheme.slug}/${file.path}`, file.data.slice().buffer as ArrayBuffer, file.mime);
  }
  return files;
}

/** The statements that store the default theme's row and asset index. */
export function defaultThemeStatements(env: Env, files: PackageFile[], opts: { active: boolean; now: string }): D1PreparedStatement[] {
  const m = defaultTheme.manifest;
  return [
    env.DB.prepare(
      `INSERT INTO themes (slug,name,version,templates,partials,css,manifest,parent,author,description,screenshot,active,created_at)
       VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?)
       ON CONFLICT(slug) DO UPDATE SET
         name=excluded.name, version=excluded.version, templates=excluded.templates, partials=excluded.partials,
         css=excluded.css, manifest=excluded.manifest, parent=NULL, author=excluded.author,
         description=excluded.description, screenshot=excluded.screenshot, active=excluded.active`,
    ).bind(
      defaultTheme.slug, defaultTheme.name, defaultTheme.version, JSON.stringify(defaultTheme.templates),
      JSON.stringify(defaultTheme.partials), defaultTheme.css, JSON.stringify(m),
      m.author, m.description, m.screenshot, opts.active ? 1 : 0, opts.now,
    ),
    ...files.map((file) => env.DB.prepare(
      `INSERT INTO theme_assets (theme_slug,path,mime,size,created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(theme_slug,path) DO UPDATE SET mime=excluded.mime, size=excluded.size`,
    ).bind(defaultTheme.slug, file.path, file.mime, file.data.byteLength, opts.now)),
  ];
}

/**
 * Themes this app used to bundle. They are no longer shipped, so an upgraded
 * site drops them; a theme the owner uploaded is never in this list.
 */
export const RETIRED_THEME_SLUGS = ['nova', 'ams-1', 'ams-base', 'ams-magazine', 'ams-studio', 'default'];

/**
 * Makes the bundled theme the site's theme: installs (or refreshes) it,
 * activates it, and removes the themes earlier releases bundled — their rows,
 * settings, snapshots and files. Themes the owner uploaded stay installed,
 * switched off. Safe to run more than once.
 */
export async function adoptDefaultTheme(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const files = await writeDefaultThemeFiles(env);
  const retired = RETIRED_THEME_SLUGS.filter((slug) => slug !== defaultTheme.slug);
  const marks = retired.map(() => '?').join(',');

  // Collect the retired themes' files before their index rows go.
  const { results: stale } = await env.DB.prepare(
    `SELECT theme_slug, path FROM theme_assets WHERE theme_slug IN (${marks})`,
  ).bind(...retired).all<{ theme_slug: string; path: string }>();

  await env.DB.batch([
    env.DB.prepare('UPDATE themes SET active=0'),
    // A theme that inherited from a retired one keeps working as a standalone theme row.
    env.DB.prepare(`UPDATE themes SET parent=NULL WHERE parent IN (${marks})`).bind(...retired),
    env.DB.prepare(`DELETE FROM themes WHERE slug IN (${marks})`).bind(...retired),
    env.DB.prepare(`DELETE FROM theme_assets WHERE theme_slug IN (${marks})`).bind(...retired),
    env.DB.prepare(`DELETE FROM theme_settings WHERE theme_slug IN (${marks})`).bind(...retired),
    env.DB.prepare(`DELETE FROM theme_versions WHERE theme_slug IN (${marks})`).bind(...retired),
    ...defaultThemeStatements(env, files, { active: true, now }),
  ]);

  for (const row of stale) {
    try { await deleteFile(env, `themes/${row.theme_slug}/${row.path}`); } catch { /* an orphaned file is harmless */ }
  }
  for (const slug of retired) {
    try { await deleteFile(env, `themes/${slug}/style.css`); } catch { /* same */ }
  }
}
