import type { Env } from '../../types';

/**
 * Forward-only migrations. schema.sql is always the full, current schema used
 * by the installer; each entry here upgrades an already-installed database.
 * Append new entries with the next version number - never edit old ones.
 */
export const SCHEMA_VERSION = 2;

const COMMENTS = [
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL DEFAULT 1,
    content_id INTEGER NOT NULL,
    parent_id INTEGER,
    author_name TEXT NOT NULL DEFAULT '',
    author_email TEXT NOT NULL DEFAULT '',
    author_url TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','spam','trash')),
    user_id INTEGER,
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_comments_list ON comments (site_id, status, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_comments_content ON comments (content_id, status)',
];

export const migrations: { version: number; name: string; statements: string[] }[] = [
  { version: 2, name: 'Comments', statements: COMMENTS },
];

/** Migration entries newer than the installed schema. */
export function pendingMigrations(current: number): { version: number; name: string }[] {
  return migrations.filter((m) => m.version > current).map((m) => ({ version: m.version, name: m.name }));
}

/** Applies pending migrations. Called from the cron trigger; cheap when up to date. */
export async function migrate(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE site_id=1 AND key='schema_version'").first<{ value: string }>();
  let current = Number(row?.value || 1);
  for (const m of migrations.filter((x) => x.version > current).sort((a, b) => a.version - b.version)) {
    await env.DB.batch([
      ...m.statements.map((s) => env.DB.prepare(s)),
      env.DB.prepare("INSERT INTO settings (site_id,key,value) VALUES (1,'schema_version',?) ON CONFLICT(site_id,key) DO UPDATE SET value=excluded.value").bind(String(m.version)),
    ]);
    current = m.version;
  }
  return current;
}

/** The version recorded in the database (1 for installs that predate migrations). */
export async function installedSchemaVersion(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE site_id=1 AND key='schema_version'").first<{ value: string }>();
  return Number(row?.value || 1);
}
