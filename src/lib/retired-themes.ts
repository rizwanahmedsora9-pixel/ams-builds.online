/**
 * Themes this app used to bundle, and the cleanup that removes them.
 *
 * The app ships no themes now: no bundled design, no theme store, no one-click
 * installs. A site is a clean slate until its owner uploads a theme, so an
 * upgrade deletes the themes earlier releases installed on the site's behalf —
 * their rows, files, settings, snapshots and the store stamps that tracked them.
 *
 * A theme the owner uploaded themselves is never in this list and is never
 * touched: it stays installed exactly as it was.
 */
import type { Env } from '../types';
import { deleteFile } from './files';
import { hasTable } from './schema';

/** Every slug the app has bundled in any release, oldest first. */
export const RETIRED_THEME_SLUGS = [
  'nova', 'ams-1', 'ams-base', 'ams-magazine', 'ams-studio', 'default',
  'ahmed-pro-theme', 'example1',
];

/**
 * Removes the retired bundled themes from a site. Returns the slugs it removed,
 * so the caller can say what happened (an up-to-date site returns []). Safe to
 * run more than once, and safe on a database old enough to be missing the
 * per-theme tables.
 */
export async function clearRetiredThemes(env: Env): Promise<string[]> {
  const marks = RETIRED_THEME_SLUGS.map(() => '?').join(',');
  let present: string[] = [];
  try {
    const { results } = await env.DB.prepare(`SELECT slug FROM themes WHERE slug IN (${marks})`)
      .bind(...RETIRED_THEME_SLUGS).all<{ slug: string }>();
    present = (results ?? []).map((row) => row.slug);
  } catch {
    return []; // no themes table yet: nothing was ever bundled into it
  }

  // The store's own bookkeeping goes whether or not a theme row is left.
  try {
    await env.DB.prepare("DELETE FROM settings WHERE site_id=1 AND key LIKE 'theme_store_stamp_%'").run();
  } catch { /* no settings rows to clear */ }
  if (!present.length) return [];

  const found = present.map(() => '?').join(',');

  // Collect the files before their index rows go, so nothing is orphaned.
  let files: { theme_slug: string; path: string }[] = [];
  if (await hasTable(env, 'theme_assets')) {
    try {
      const { results } = await env.DB.prepare(`SELECT theme_slug, path FROM theme_assets WHERE theme_slug IN (${found})`)
        .bind(...present).all<{ theme_slug: string; path: string }>();
      files = results ?? [];
    } catch { /* an unreadable index only means the files stay behind */ }
  }

  const statements = [
    // A theme that inherited from a retired one keeps working as a standalone row.
    env.DB.prepare(`UPDATE themes SET parent=NULL WHERE parent IN (${found})`).bind(...present),
    env.DB.prepare(`DELETE FROM themes WHERE slug IN (${found})`).bind(...present),
  ];
  for (const table of ['theme_assets', 'theme_settings', 'theme_versions']) {
    if (await hasTable(env, table)) {
      statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE theme_slug IN (${found})`).bind(...present));
    }
  }
  await env.DB.batch(statements);

  for (const row of files) {
    try { await deleteFile(env, `themes/${row.theme_slug}/${row.path}`); } catch { /* an orphaned file is harmless */ }
  }
  for (const slug of present) {
    // The stylesheet is stored as an asset row for an installed theme, but a
    // bundled one was also written straight to the file store.
    try { await deleteFile(env, `themes/${slug}/style.css`); } catch { /* same */ }
  }
  return present;
}
