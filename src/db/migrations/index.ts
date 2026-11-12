import type { Env } from '../../types';
import { resetSchemaCache } from '../../lib/schema';

/**
 * Forward-only migrations. schema.sql is always the full, current schema used
 * by the installer; each entry here upgrades an already-installed database.
 * Append new entries with the next version number - never edit old ones.
 */
export const SCHEMA_VERSION = 7;

/**
 * A migration statement that must not take the whole batch down.
 *
 * `ALTER TABLE ... ADD COLUMN` has no IF NOT EXISTS in SQLite, so on a database
 * that already has the column (a fresh install also gets these columns from
 * schema.sql) the statement fails. Ignoring the error by message keeps the
 * migration idempotent without splitting it into a different runner.
 */
const tolerant = (statement: string): string => `-- +ams-ignore duplicate column name
${statement}`;

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

/**
 * Phase 2 tables plus the content columns the workflow needs. `ADD COLUMN` has
 * no `IF NOT EXISTS` in SQLite, so these statements are only run once, by the
 * migration runner (it records the version in settings).
 */
const EDITOR_WORKFLOW = [
  `CREATE TABLE IF NOT EXISTS content_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL DEFAULT 1,
    content_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    slug TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '',
    seo_title TEXT NOT NULL DEFAULT '',
    seo_description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    author_id INTEGER,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_revisions_content ON content_revisions (content_id, id DESC)',
  `CREATE TABLE IF NOT EXISTS content_lock (
    content_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL DEFAULT '',
    heartbeat_at TEXT NOT NULL
  )`,
  tolerant('ALTER TABLE content ADD COLUMN updated_by INTEGER'),
  tolerant('ALTER TABLE content ADD COLUMN menu_order INTEGER NOT NULL DEFAULT 0'),
  tolerant('ALTER TABLE content ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0'),
];

/**
 * Phase 2b: the `order_by` setting themes read, and a safe default for it. The
 * setting itself lives in the settings table, so there is nothing to create;
 * the migration exists so a database that ran an early build of version 3 gets
 * a consistent version number.
 */
/**
 * Phase 3: theme packages. The asset bytes live in the file store; these tables
 * are the index, the version snapshots and the per-theme settings.
 * `themes` gains the columns a v2 manifest fills in.
 */
const THEME_PLATFORM = [
  `CREATE TABLE IF NOT EXISTS theme_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_slug TEXT NOT NULL,
    path TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (theme_slug, path)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_theme_assets_slug ON theme_assets (theme_slug)',
  `CREATE TABLE IF NOT EXISTS theme_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_slug TEXT NOT NULL,
    version TEXT NOT NULL,
    name TEXT NOT NULL,
    templates TEXT NOT NULL,
    partials TEXT NOT NULL DEFAULT '{}',
    css TEXT NOT NULL DEFAULT '',
    manifest TEXT NOT NULL DEFAULT '{}',
    assets TEXT NOT NULL DEFAULT '[]',
    note TEXT NOT NULL DEFAULT '',
    author_id INTEGER,
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_theme_versions_slug ON theme_versions (theme_slug, id DESC)',
  `CREATE TABLE IF NOT EXISTS theme_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_slug TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    UNIQUE (theme_slug, key)
  )`,
  tolerant("ALTER TABLE themes ADD COLUMN partials TEXT NOT NULL DEFAULT '{}'"),
  tolerant("ALTER TABLE themes ADD COLUMN manifest TEXT NOT NULL DEFAULT '{}'"),
  tolerant("ALTER TABLE themes ADD COLUMN parent TEXT"),
  tolerant("ALTER TABLE themes ADD COLUMN author TEXT NOT NULL DEFAULT ''"),
  tolerant("ALTER TABLE themes ADD COLUMN description TEXT NOT NULL DEFAULT ''"),
  tolerant("ALTER TABLE themes ADD COLUMN screenshot TEXT NOT NULL DEFAULT ''"),
];

/**
 * Phase 4: a page or post may name the theme template that renders it
 * (`page-landing`). Empty means "the default template for this kind of content".
 */
/**
 * Phase 6: every mutation in the panel writes one row here (lib/audit.ts is the
 * only writer). The indexes follow how the log is read: newest first, by user,
 * and by action. Retention is time-based, so no index on a status column.
 */
const AUDIT = [
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id TEXT,
    summary TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_audit_recent ON audit_log (id DESC)',
  'CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log (user_id, id DESC)',
  'CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action, id DESC)',
];

const TEMPLATES = [
  tolerant("ALTER TABLE content ADD COLUMN template TEXT NOT NULL DEFAULT ''"),
];

const WORKFLOW_FIXES = [
  "INSERT INTO settings (site_id, key, value) VALUES (1, 'pages_order', 'menu_order') ON CONFLICT(site_id, key) DO NOTHING",
];

export const migrations: { version: number; name: string; statements: string[] }[] = [
  { version: 2, name: 'Comments', statements: COMMENTS },
  { version: 3, name: 'Revisions, edit locks and page ordering', statements: EDITOR_WORKFLOW },
  { version: 4, name: 'Page ordering default', statements: WORKFLOW_FIXES },
  { version: 5, name: 'Theme platform: assets, partials, versions', statements: THEME_PLATFORM },
  { version: 6, name: 'Per-page templates', statements: TEMPLATES },
  { version: 7, name: 'Audit log', statements: AUDIT },
];

/** Runs one migration statement, tolerating the errors marked in its comment. */
async function runStatement(env: Env, statement: string): Promise<void> {
  const ignore = statement.match(/^\s*--\s*\+ams-ignore\s+(.+)$/m)?.[1]?.trim().toLowerCase();
  const sql = statement.replace(/^\s*--.*$/gm, '').trim();
  if (!sql) return;
  try {
    await env.DB.prepare(sql).run();
  } catch (error) {
    const message = String(error).toLowerCase();
    if (ignore && message.includes(ignore)) return;
    throw error;
  }
}

/** Migration entries newer than the installed schema. */
export function pendingMigrations(current: number): { version: number; name: string }[] {
  return migrations.filter((m) => m.version > current).map((m) => ({ version: m.version, name: m.name }));
}

/** Applies pending migrations. Called from the cron trigger; cheap when up to date. */
export async function migrate(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE site_id=1 AND key='schema_version'").first<{ value: string }>();
  let current = Number(row?.value || 1);
  for (const m of migrations.filter((x) => x.version > current).sort((a, b) => a.version - b.version)) {
    for (const statement of m.statements) await runStatement(env, statement);
    await env.DB.prepare(
      "INSERT INTO settings (site_id,key,value) VALUES (1,'schema_version',?) ON CONFLICT(site_id,key) DO UPDATE SET value=excluded.value",
    ).bind(String(m.version)).run();
    current = m.version;
  }
  // The app caches "does this table exist" for a few seconds; a migration is
  // exactly the moment that answer changes.
  resetSchemaCache(env);
  return current;
}

/** The version recorded in the database (1 for installs that predate migrations). */
export async function installedSchemaVersion(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE site_id=1 AND key='schema_version'").first<{ value: string }>();
  return Number(row?.value || 1);
}
