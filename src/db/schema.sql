-- Edge CMS schema (version 1).
-- Every content table carries site_id (default 1) so a multi-site setup can be
-- enabled later by filling the `sites` table (hostname -> site id) without
-- reshaping any existing table.
-- NOTE: the installer splits this file on semicolons. Do not put semicolons
-- inside string literals and do not add triggers here.

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hostname TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'author' CHECK (role IN ('admin','editor','author')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  site_id INTEGER NOT NULL DEFAULT 1,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (site_id, key)
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  alt TEXT NOT NULL DEFAULT '',
  uploaded_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1,
  type TEXT NOT NULL CHECK (type IN ('page','post')),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','scheduled')),
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  featured_media_id INTEGER,
  author_id INTEGER,
  published_at TEXT,
  updated_by INTEGER,
  menu_order INTEGER NOT NULL DEFAULT 0,
  parent_id INTEGER,
  icon TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  -- Phase 4: the theme template that renders this item ('' = the default one).
  template TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (site_id, type, slug)
);
CREATE INDEX IF NOT EXISTS idx_content_list ON content (site_id, type, status, published_at);
CREATE INDEX IF NOT EXISTS idx_content_parent ON content (site_id, type, parent_id, menu_order);

-- Phase 2: an append-only history of every save, so nothing is ever lost.
CREATE TABLE IF NOT EXISTS content_revisions (
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
);
CREATE INDEX IF NOT EXISTS idx_revisions_content ON content_revisions (content_id, id DESC);

-- Phase 2: a person currently editing a post, so two sessions cannot silently
-- overwrite each other. Advisory only: the row expires.
CREATE TABLE IF NOT EXISTS content_lock (
  content_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  heartbeat_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1,
  taxonomy TEXT NOT NULL CHECK (taxonomy IN ('category','tag')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  UNIQUE (site_id, taxonomy, slug)
);

CREATE TABLE IF NOT EXISTS content_terms (
  content_id INTEGER NOT NULL,
  term_id INTEGER NOT NULL,
  PRIMARY KEY (content_id, term_id)
);
CREATE INDEX IF NOT EXISTS idx_content_terms_term ON content_terms (term_id);

-- Posts assigned to specific CMS Pages / sub-pages (empty = main blog & home).
CREATE TABLE IF NOT EXISTS content_pages (
  content_id INTEGER NOT NULL,
  page_id INTEGER NOT NULL,
  PRIMARY KEY (content_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_content_pages_page ON content_pages (page_id);

CREATE TABLE IF NOT EXISTS menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_menu_items_menu ON menu_items (menu_id, position);

CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  templates TEXT NOT NULL,
  partials TEXT NOT NULL DEFAULT '{}',
  css TEXT NOT NULL DEFAULT '',
  manifest TEXT NOT NULL DEFAULT '{}',
  parent TEXT,
  author TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  screenshot TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Phase 3: theme packages. Binary assets live in the file store; this table is
-- the index (sizes, mime types) that the theme manager and size caps read.
CREATE TABLE IF NOT EXISTS theme_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_slug TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (theme_slug, path)
);
CREATE INDEX IF NOT EXISTS idx_theme_assets_slug ON theme_assets (theme_slug);

-- A snapshot written before every activation, so a theme change can be undone.
CREATE TABLE IF NOT EXISTS theme_versions (
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
);
CREATE INDEX IF NOT EXISTS idx_theme_versions_slug ON theme_versions (theme_slug, id DESC);

-- One row per theme setting that has been changed in the panel.
CREATE TABLE IF NOT EXISTS theme_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_slug TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  UNIQUE (theme_slug, key)
);

CREATE TABLE IF NOT EXISTS redirects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1,
  from_path TEXT NOT NULL,
  to_url TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 301,
  UNIQUE (site_id, from_path)
);

CREATE TABLE IF NOT EXISTS hooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1,
  hook TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Phase 6: the audit log. One row per mutation, written by lib/audit.ts, pruned
-- after 90 days by the cron trigger. user_id is null when an action ran without
-- a session (the installer, a scheduled publish).
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_recent ON audit_log (id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log (user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action, id DESC);
