// CmsSite — the single Durable Object that holds everything the admin edits:
// content entries (blog/pages/projects/settings), uploaded images, admin
// credentials, sessions and publish status. SQLite-backed storage (10 GB per
// object, ample for an agency site).
import { DurableObject } from 'cloudflare:workers';
import { hashPassword, verifyPassword } from '../src/lib/password.mjs';
import { buildExportPayload } from '../src/lib/export-filter.mjs';
import { INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_USERNAME } from '../src/lib/initial-auth.mjs';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // rate-limit window
const LOGIN_MAX_FAILS = 30; // per window
const MAX_MEDIA_BYTES = 4 * 1024 * 1024; // 4 MB per image
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MEDIA_PATH_RE = /^\/images\/uploads\/[A-Za-z0-9._-]+$/;

function nowIso() {
  return new Date().toISOString();
}

function json(value) {
  return JSON.stringify(value ?? null);
}

export class CmsSite extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        slug TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        frontmatter TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS media (
        path TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        content BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
    `);
  }

  // ── meta ────────────────────────────────────────────────────────────────
  getMeta(key) {
    const row = this.sql.exec('SELECT v FROM meta WHERE k = ?', key).toArray();
    if (!row.length) return null;
    try {
      return JSON.parse(row[0].v);
    } catch {
      return null;
    }
  }

  setMeta(key, value) {
    this.sql.exec(
      'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      key,
      json(value),
    );
    return true;
  }

  // ── entries ─────────────────────────────────────────────────────────────
  listEntries() {
    const rows = this.sql
      .exec('SELECT slug, type, frontmatter, updated_at, deleted FROM entries ORDER BY slug')
      .toArray();
    return rows.map((r) => ({
      slug: r.slug,
      type: r.type,
      frontmatter: safeJson(r.frontmatter, {}),
      updated_at: r.updated_at,
      deleted: r.deleted === 1,
    }));
  }

  getEntry(slug) {
    const rows = this.sql
      .exec('SELECT slug, type, frontmatter, body, updated_at, deleted FROM entries WHERE slug = ?', slug)
      .toArray();
    if (!rows.length) return null;
    const r = rows[0];
    return {
      slug: r.slug,
      type: r.type,
      frontmatter: safeJson(r.frontmatter, {}),
      body: r.body ?? '',
      updated_at: r.updated_at,
      deleted: r.deleted === 1,
    };
  }

  putEntry(slug, type, frontmatter, body) {
    if (typeof slug !== 'string' || !slug || typeof type !== 'string' || !type) {
      return { ok: false, reason: 'invalid' };
    }
    const updated = nowIso();
    this.sql.exec(
      `INSERT INTO entries (slug, type, frontmatter, body, updated_at, deleted)
       VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(slug) DO UPDATE SET
         type = excluded.type,
         frontmatter = excluded.frontmatter,
         body = excluded.body,
         updated_at = excluded.updated_at,
         deleted = 0`,
      slug,
      type,
      json(frontmatter),
      typeof body === 'string' ? body : '',
      updated,
    );
    return { ok: true, updated_at: updated };
  }

  deleteEntry(slug, type) {
    const existing = this.getEntry(slug);
    const updated = nowIso();
    if (existing) {
      this.sql.exec(
        'UPDATE entries SET deleted = 1, updated_at = ? WHERE slug = ?',
        updated,
        slug,
      );
    } else {
      // Tombstone so the git copy of the file does not come back after a rebuild.
      this.sql.exec(
        'INSERT INTO entries (slug, type, frontmatter, body, updated_at, deleted) VALUES (?, ?, ?, ?, ?, 1)',
        slug,
        type || '',
        '{}',
        '',
        updated,
      );
    }
    return { ok: true, updated_at: updated };
  }

  // Everything the public build needs, in one round trip: entries (drafts keep
  // metadata only so unpublished bodies never leave the Worker) + settings.
  exportAll() {
    const rows = this.sql
      .exec('SELECT slug, type, frontmatter, body, updated_at, deleted FROM entries')
      .toArray()
      .map((r) => ({
        slug: r.slug,
        type: r.type,
        frontmatter: safeJson(r.frontmatter, {}),
        body: r.body ?? '',
        updated_at: r.updated_at,
        deleted: r.deleted === 1,
      }));
    const site = rows.find((r) => r.slug === 'site' && r.type === 'settings' && !r.deleted);
    return buildExportPayload(rows, site ? site.frontmatter : null);
  }

  // ── media ───────────────────────────────────────────────────────────────
  listMedia() {
    const rows = this.sql
      .exec('SELECT path, mime, size, updated_at FROM media ORDER BY updated_at DESC')
      .toArray();
    return rows.map((r) => ({ path: r.path, mime: r.mime, size: r.size, updated_at: r.updated_at }));
  }

  getMedia(path) {
    if (typeof path !== 'string' || !MEDIA_PATH_RE.test(path)) return null;
    const rows = this.sql
      .exec('SELECT path, mime, size, updated_at, content FROM media WHERE path = ?', path)
      .toArray();
    if (!rows.length) return null;
    const r = rows[0];
    return {
      path: r.path,
      mime: r.mime,
      size: r.size,
      updated_at: r.updated_at,
      content: r.content instanceof ArrayBuffer ? r.content : toArrayBuffer(r.content),
    };
  }

  putMedia(path, mime, bytes) {
    if (typeof path !== 'string' || !MEDIA_PATH_RE.test(path)) {
      return { ok: false, reason: 'bad-path' };
    }
    if (!ALLOWED_IMAGE_MIME.includes(mime)) {
      return { ok: false, reason: 'bad-type' };
    }
    const buf = toUint8(bytes);
    if (!buf || buf.byteLength === 0) return { ok: false, reason: 'empty' };
    if (buf.byteLength > MAX_MEDIA_BYTES) return { ok: false, reason: 'too-large' };
    const updated = nowIso();
    this.sql.exec(
      `INSERT INTO media (path, mime, size, updated_at, content)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         mime = excluded.mime,
         size = excluded.size,
         updated_at = excluded.updated_at,
         content = excluded.content`,
      path,
      mime,
      buf.byteLength,
      updated,
      buf,
    );
    return { ok: true, path, size: buf.byteLength, updated_at: updated };
  }

  deleteMedia(path) {
    const before = this.getMedia(path);
    if (before) this.sql.exec('DELETE FROM media WHERE path = ?', path);
    return { ok: true, existed: Boolean(before) };
  }

  // ── auth + sessions ─────────────────────────────────────────────────────
  getAuthRecord() {
    const rows = this.sql.exec("SELECT v FROM auth WHERE k = 'password'").toArray();
    if (!rows.length) return null;
    return safeJson(rows[0].v, null);
  }

  async login(username, password) {
    const user = String(username ?? '').trim();
    const pass = String(password ?? '');
    if (!user || !pass) return { ok: false, reason: 'missing' };

    const record = this.getAuthRecord();

    if (!record) {
      // Initialize only from the documented credentials. Never let an
      // anonymous visitor claim a fresh deployment with arbitrary details.
      if (user !== INITIAL_ADMIN_USERNAME || pass !== INITIAL_ADMIN_PASSWORD) {
        return { ok: false, reason: 'bad-credentials' };
      }
      const hashed = await hashPassword(pass);
      this.sql.exec(
        "INSERT INTO auth (k, v) VALUES ('password', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        json({ u: INITIAL_ADMIN_USERNAME, ...hashed }),
      );
      return this.#issueSession(INITIAL_ADMIN_USERNAME);
    }

    // Simple rate limiting: brute force is pointless against PBKDF2 anyway.
    const attempts = this.getMeta('login_attempts') || { fails: 0, first: 0 };
    const windowStart = attempts.first || 0;
    const reset = !windowStart || Date.now() - windowStart > LOGIN_WINDOW_MS;
    const fails = reset ? 0 : attempts.fails || 0;
    if (fails >= LOGIN_MAX_FAILS) {
      const retryAt = windowStart + LOGIN_WINDOW_MS;
      if (Date.now() < retryAt) {
        return { ok: false, reason: 'locked', retryAt };
      }
    }

    const userOk = user === record.u;
    const passOk = await verifyPassword(pass, record.salt, record.hash, record.it);
    if (!userOk || !passOk) {
      const next = reset || !windowStart
        ? { fails: 1, first: Date.now() }
        : { fails: fails + 1, first: windowStart };
      this.setMeta('login_attempts', next);
      if (next.fails >= LOGIN_MAX_FAILS) {
        return { ok: false, reason: 'locked', retryAt: next.first + LOGIN_WINDOW_MS };
      }
      return { ok: false, reason: 'bad-credentials' };
    }

    this.setMeta('login_attempts', null);
    this.sql.exec('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    return this.#issueSession(record.u);
  }

  #issueSession(user) {
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.sql.exec('INSERT INTO sessions (id, user, expires_at) VALUES (?, ?, ?)', id, user, expiresAt);
    return { ok: true, session: id, expiresAt, user };
  }

  validateSession(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return { ok: false };
    const rows = this.sql
      .exec('SELECT id, user, expires_at FROM sessions WHERE id = ?', sessionId)
      .toArray();
    if (!rows.length) return { ok: false };
    const r = rows[0];
    if (r.expires_at < Date.now()) {
      this.sql.exec('DELETE FROM sessions WHERE id = ?', sessionId);
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, user: r.user, expiresAt: r.expires_at };
  }

  logout(sessionId) {
    if (typeof sessionId === 'string' && sessionId) {
      this.sql.exec('DELETE FROM sessions WHERE id = ?', sessionId);
    }
    return { ok: true };
  }

  async changePassword(sessionId, currentPassword, newPassword) {
    const session = this.validateSession(sessionId);
    if (!session.ok) return { ok: false, reason: 'unauthenticated' };
    const record = this.getAuthRecord();
    if (!record) return { ok: false, reason: 'no-password' };
    const currentOk = await verifyPassword(
      String(currentPassword ?? ''),
      record.salt,
      record.hash,
      record.it,
    );
    if (!currentOk) return { ok: false, reason: 'bad-current' };
    const next = String(newPassword ?? '');
    if (next.length < 6) return { ok: false, reason: 'too-short' };
    const hashed = await hashPassword(next);
    this.sql.exec(
      "UPDATE auth SET v = ? WHERE k = 'password'",
      json({ u: record.u, ...hashed }),
    );
    // Keep the current session alive, drop every other one.
    this.sql.exec('DELETE FROM sessions WHERE id != ?', sessionId);
    return { ok: true };
  }

  // ── publish bookkeeping ─────────────────────────────────────────────────
  recordPublish(result) {
    this.setMeta('last_publish', { at: nowIso(), ...result });
    return { ok: true };
  }

  getLastPublish() {
    return this.getMeta('last_publish');
  }
}

// ── helpers ───────────────────────────────────────────────────────────────
function safeJson(text, fallback) {
  try {
    const value = JSON.parse(text);
    return value === null || value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function toUint8(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}

function toArrayBuffer(value) {
  const u8 = toUint8(value);
  if (!u8) return new ArrayBuffer(0);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}
