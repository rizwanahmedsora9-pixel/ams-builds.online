import type { Env } from '../../types';

/**
 * Forward-only migrations. schema.sql is always the full, current schema used
 * by the installer; each entry here upgrades an already-installed database.
 * Append new entries with the next version number - never edit old ones.
 */
export const SCHEMA_VERSION = 1;

export const migrations: { version: number; statements: string[] }[] = [
  // { version: 2, statements: ["ALTER TABLE content ADD COLUMN template TEXT NOT NULL DEFAULT ''"] },
];

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
