/**
 * Schema capability probes.
 *
 * Migrations only run from the cron trigger or an explicit "Run updates" click,
 * so between a deploy and that click the app is talking to the previous schema.
 * Instead of guarding every query with a broad try/catch (which hides real
 * bugs), screens ask whether the specific table or column they need is there.
 * The answer is cached per request in the context-free module map, keyed by the
 * table name, because a D1/SQLite lookup is cheap but not free.
 */
import type { Env } from '../types';

const tableCache = new WeakMap<object, Map<string, boolean>>();
const columnCache = new WeakMap<object, Map<string, boolean>>();
/** Answers are cached briefly: a migration can add tables while the app runs. */
const TTL_MS = 5_000;
const stamps = new WeakMap<object, number>();

function cache(map: WeakMap<object, Map<string, boolean>>, key: object, name: string, value: boolean): boolean {
  const inner = map.get(key) ?? new Map<string, boolean>();
  inner.set(name, value);
  map.set(key, inner);
  stamps.set(key, Date.now());
  return value;
}

function cached(map: WeakMap<object, Map<string, boolean>>, key: object, name: string): boolean | undefined {
  const stamp = stamps.get(key);
  if (!stamp || Date.now() - stamp > TTL_MS) return undefined;
  const value = map.get(key)?.get(name);
  if (value === false && Date.now() - stamp > 1_000) return undefined;
  return value;
}

/** Forget everything we learned about this database, e.g. right after a migration. */
export function resetSchemaCache(env: Env): void {
  tableCache.delete(env);
  columnCache.delete(env);
  stamps.delete(env);
}

/**
 * True when the table exists in this database. POSITIVE answers are cached for a
 * few seconds; a "no" is cached only for a second, because the usual reason for
 * a miss is a migration that is about to run (or just did).
 */
export async function hasTable(env: Env, name: string): Promise<boolean> {
  const hit = cached(tableCache, env, name);
  if (hit !== undefined) return hit;
  try {
    const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first<{ name: string }>();
    return cache(tableCache, env, name, !!row);
  } catch {
    // Cloudflare D1 also answers sqlite_master; a failure here means "assume no".
    return cache(tableCache, env, name, false);
  }
}

/** True when the column exists on the table (PRAGMA is supported by both runtimes). */
export async function hasColumn(env: Env, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const hit = cached(columnCache, env, key);
  if (hit !== undefined) return hit;
  try {
    const res = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    return cache(columnCache, env, key, res.results.some((row) => row.name === column));
  } catch {
    return cache(columnCache, env, key, false);
  }
}

/** Every table Phase 2 needs before revisions and locks are usable. */
export async function hasPhase2Schema(env: Env): Promise<boolean> {
  return (await hasTable(env, 'content_revisions')) && (await hasTable(env, 'content_lock'));
}
