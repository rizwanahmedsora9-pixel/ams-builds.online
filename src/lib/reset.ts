/**
 * Factory reset: put the panel back to the state it had before the installer ran.
 *
 * "Start again" used to mean "stop the server and delete the data folder", which
 * is fine on a laptop and impossible from a phone, a container or a Workers
 * deployment. This does the same thing from inside the running app, on both
 * runtimes:
 *
 *   - every CMS table is dropped, so the installer's schema runner rebuilds them
 *   - the runtime's own tables (`_kv`, `_files` on Node) are emptied instead of
 *     dropped, because the objects holding the open database were built around
 *     them and a missing table would take the process down with it
 *   - uploaded files go too: the media folder on Node, every key in KV on
 *     Cloudflare (which includes the `media:*` values and the page cache)
 *   - the install lock and the config (admin URL, session secret, cache
 *     generation, database password) live in KV, so deleting them is what makes
 *     the root app redirect every URL to /install again
 *
 * Two caches outlive the data and are cleared here, or the next request would
 * still believe the old site exists: the "does this table exist" probes
 * (lib/schema.ts) and the per-isolate install memo (lib/config.ts).
 */
import type { Env } from '../types';
import { resetInstallState } from './config';
import { resetSchemaCache } from './schema';

/**
 * Tables that belong to the storage shim rather than to the CMS. They are emptied,
 * never dropped: `openStorage` created them once, at boot, and the live KeyValue
 * and DiskFiles objects keep using them for the rest of the process.
 */
const RUNTIME_TABLES = new Set(['_kv', '_files']);

/** Identifiers only, never interpolated user input - a name from sqlite_master
 *  that is not a plain identifier is skipped rather than quoted into a statement. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ResetSummary = {
  /** Tables dropped or emptied. */
  tables: number;
  /** Stored files removed (Node: rows in the file index). */
  files: number;
  /** Key-value entries deleted (Cloudflare; on Node they are rows in `_kv`). */
  keys: number;
};

/** Every table in this database, runtime tables included. */
export async function listTables(env: Env): Promise<string[]> {
  try {
    const { results } = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all<{ name: string }>();
    return results.map((r) => String(r.name)).filter((name) => IDENTIFIER.test(name));
  } catch {
    return [];
  }
}

async function countFiles(env: Env): Promise<number> {
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM _files').first<{ n: number }>();
    return Number(row?.n || 0);
  } catch {
    return 0; // no file index on this runtime: the files are KV values
  }
}

/**
 * Deletes every key in the key-value store, a page at a time. Only the Cloudflare
 * runtime gets here: the Node shim keeps its keys in `_kv`, which the table wipe
 * above empties, and it has no `list`.
 */
async function purgeKeyValue(env: Env): Promise<number> {
  if (typeof env.KV.list !== 'function') return 0;
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await env.KV.list({ cursor, limit: 1000 });
    for (const key of page.keys) {
      await env.KV.delete(key.name);
      removed++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return removed;
}

/**
 * Empties the site. The database and the storage bindings stay usable - the same
 * process goes on serving, and the next request is redirected to the installer,
 * which recreates the schema from scratch.
 */
export async function factoryReset(env: Env): Promise<ResetSummary> {
  const summary: ResetSummary = { tables: 0, files: 0, keys: 0 };
  // Counted before the index that holds the count is emptied.
  summary.files = await countFiles(env);

  for (const name of await listTables(env)) {
    try {
      // One statement per table rather than one batch: a batch rolls back as a
      // whole, and a half-reset site is worse than a reset with one table left.
      await env.DB.prepare(RUNTIME_TABLES.has(name) ? `DELETE FROM ${name}` : `DROP TABLE IF EXISTS ${name}`).run();
      summary.tables++;
    } catch (err) {
      console.error(`reset: could not clear ${name}:`, err);
    }
  }

  if (env.FILES?.clear) await env.FILES.clear();
  else summary.keys = await purgeKeyValue(env);

  // Both caches still describe the site that no longer exists.
  resetSchemaCache(env);
  resetInstallState();
  return summary;
}

export type ResetCounts = {
  pages: number;
  posts: number;
  media: number;
  comments: number;
  users: number;
  themes: number;
  menus: number;
  redirects: number;
  backups: number;
};

/**
 * What a reset would destroy, for the confirmation screen. Every count is
 * independent and falls back to zero, so a database that has not run a migration
 * yet still shows a full list of numbers instead of an error.
 */
export async function resetCounts(env: Env): Promise<ResetCounts> {
  const count = async (key: keyof ResetCounts, sql: string): Promise<[keyof ResetCounts, number]> => {
    try {
      return [key, Number((await env.DB.prepare(sql).first<{ n: number }>())?.n || 0)];
    } catch {
      return [key, 0];
    }
  };
  const rows = await Promise.all([
    count('pages', "SELECT COUNT(*) AS n FROM content WHERE site_id=1 AND type='page'"),
    count('posts', "SELECT COUNT(*) AS n FROM content WHERE site_id=1 AND type='post'"),
    count('media', 'SELECT COUNT(*) AS n FROM media WHERE site_id=1'),
    count('comments', 'SELECT COUNT(*) AS n FROM comments WHERE site_id=1'),
    count('users', 'SELECT COUNT(*) AS n FROM users'),
    count('themes', 'SELECT COUNT(*) AS n FROM themes'),
    count('menus', 'SELECT COUNT(*) AS n FROM menus'),
    count('redirects', 'SELECT COUNT(*) AS n FROM redirects WHERE site_id=1'),
    count('backups', 'SELECT COUNT(*) AS n FROM backups'),
  ]);
  return Object.fromEntries(rows) as ResetCounts;
}

/** True when there is anything at all to lose. */
export const hasContent = (counts: ResetCounts): boolean => Object.values(counts).some((n) => n > 0);
