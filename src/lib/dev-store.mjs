// File-backed stand-in for the CmsSite Durable Object during `astro dev`.
// Same method names and shapes as worker/cms-do.js so the admin API does not
// care which store it is talking to. Never bundled into the Worker build —
// only reached through a dynamic import guarded by `import.meta.env.DEV`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExportPayload } from './export-filter.mjs';
import { hashPassword, verifyPassword } from './password.mjs';
import { INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_USERNAME } from './initial-auth.mjs';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 30;
const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MEDIA_PATH_RE = /^\/images\/uploads\/[A-Za-z0-9._-]+$/;

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const dir = path.join(root, '.dev-cms');
const mediaDir = path.join(dir, 'media');

function file(name) {
  return path.join(dir, name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(value, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

export function createDevStore() {
  fs.mkdirSync(mediaDir, { recursive: true });
  let entries = readJson('entries.json', {});
  let auth = readJson('auth.json', null);
  let sessions = readJson('sessions.json', {});
  let meta = readJson('meta.json', {});

  const saveEntries = () => writeJson('entries.json', entries);
  const saveSessions = () => writeJson('sessions.json', sessions);
  const saveMeta = () => writeJson('meta.json', meta);

  const store = {
    kind: 'dev',

    getMeta(key) {
      return meta[key] ?? null;
    },
    setMeta(key, value) {
      meta[key] = value ?? null;
      saveMeta();
      return true;
    },

    listEntries() {
      return Object.values(entries)
        .map((row) => ({
          slug: row.slug,
          type: row.type,
          frontmatter: row.frontmatter || {},
          updated_at: row.updated_at,
          deleted: row.deleted === true,
        }))
        .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    },

    getEntry(slug) {
      const row = entries[slug];
      if (!row) return null;
      return {
        slug: row.slug,
        type: row.type,
        frontmatter: row.frontmatter || {},
        body: row.body || '',
        updated_at: row.updated_at,
        deleted: row.deleted === true,
      };
    },

    putEntry(slug, type, frontmatter, body) {
      if (typeof slug !== 'string' || !slug || typeof type !== 'string' || !type) {
        return { ok: false, reason: 'invalid' };
      }
      const updated = nowIso();
      entries[slug] = {
        slug,
        type,
        frontmatter: frontmatter && typeof frontmatter === 'object' ? frontmatter : {},
        body: typeof body === 'string' ? body : '',
        updated_at: updated,
        deleted: false,
      };
      saveEntries();
      return { ok: true, updated_at: updated };
    },

    deleteEntry(slug, type) {
      const existing = entries[slug];
      const updated = nowIso();
      if (existing) {
        existing.deleted = true;
        existing.updated_at = updated;
      } else {
        entries[slug] = { slug, type: type || '', frontmatter: {}, body: '', updated_at: updated, deleted: true };
      }
      saveEntries();
      return { ok: true, updated_at: updated };
    },

    exportAll() {
      const rows = Object.values(entries).map((row) => ({
        slug: row.slug,
        type: row.type,
        frontmatter: row.frontmatter || {},
        body: row.body || '',
        updated_at: row.updated_at,
        deleted: row.deleted === true,
      }));
      const site = rows.find((r) => r.slug === 'site' && r.type === 'settings' && !r.deleted);
      return buildExportPayload(rows, site ? site.frontmatter : null);
    },

    listMedia() {
      const manifest = readJson('media.json', {});
      return Object.values(manifest).sort((a, b) =>
        (a.updated_at || '') < (b.updated_at || '') ? 1 : -1,
      );
    },

    getMedia(mediaPath) {
      if (typeof mediaPath !== 'string' || !MEDIA_PATH_RE.test(mediaPath)) return null;
      const manifest = readJson('media.json', {});
      const row = manifest[mediaPath];
      if (!row) return null;
      try {
        const content = fs.readFileSync(path.join(mediaDir, path.basename(mediaPath)));
        return {
          path: mediaPath,
          mime: row.mime,
          size: row.size,
          updated_at: row.updated_at,
          content: content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
        };
      } catch {
        return null;
      }
    },

    putMedia(mediaPath, mime, bytes) {
      if (typeof mediaPath !== 'string' || !MEDIA_PATH_RE.test(mediaPath)) {
        return { ok: false, reason: 'bad-path' };
      }
      if (!ALLOWED_IMAGE_MIME.includes(mime)) return { ok: false, reason: 'bad-type' };
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (!u8.byteLength) return { ok: false, reason: 'empty' };
      if (u8.byteLength > MAX_MEDIA_BYTES) return { ok: false, reason: 'too-large' };
      const manifest = readJson('media.json', {});
      const updated = nowIso();
      fs.writeFileSync(path.join(mediaDir, path.basename(mediaPath)), u8);
      manifest[mediaPath] = { path: mediaPath, mime, size: u8.byteLength, updated_at: updated };
      writeJson('media.json', manifest);
      return { ok: true, path: mediaPath, size: u8.byteLength, updated_at: updated };
    },

    deleteMedia(mediaPath) {
      const manifest = readJson('media.json', {});
      const existed = Boolean(manifest[mediaPath]);
      delete manifest[mediaPath];
      writeJson('media.json', manifest);
      try {
        fs.unlinkSync(path.join(mediaDir, path.basename(mediaPath)));
      } catch {
        /* already gone */
      }
      return { ok: true, existed };
    },

    async login(username, password) {
      const user = String(username ?? '').trim();
      const pass = String(password ?? '');
      if (!user || !pass) return { ok: false, reason: 'missing' };

      if (!auth) {
        if (user !== INITIAL_ADMIN_USERNAME || pass !== INITIAL_ADMIN_PASSWORD) {
          return { ok: false, reason: 'bad-credentials' };
        }
        const hashed = await hashPassword(pass);
        auth = { u: INITIAL_ADMIN_USERNAME, ...hashed };
        writeJson('auth.json', auth);
        return issueSession();
      }

      const attempts = store.getMeta('login_attempts') || { fails: 0, first: 0 };
      const windowStart = attempts.first || 0;
      const reset = !windowStart || Date.now() - windowStart > LOGIN_WINDOW_MS;
      const fails = reset ? 0 : attempts.fails || 0;
      if (fails >= LOGIN_MAX_FAILS && Date.now() < windowStart + LOGIN_WINDOW_MS) {
        return { ok: false, reason: 'locked', retryAt: windowStart + LOGIN_WINDOW_MS };
      }

      const userOk = user === auth.u;
      const passOk = await verifyPassword(pass, auth.salt, auth.hash, auth.it);
      if (!userOk || !passOk) {
        const next = reset || !windowStart
          ? { fails: 1, first: Date.now() }
          : { fails: fails + 1, first: windowStart };
        store.setMeta('login_attempts', next);
        if (next.fails >= LOGIN_MAX_FAILS) {
          return { ok: false, reason: 'locked', retryAt: next.first + LOGIN_WINDOW_MS };
        }
        return { ok: false, reason: 'bad-credentials' };
      }

      store.setMeta('login_attempts', null);
      const cutoff = Date.now();
      let pruned = false;
      for (const [id, row] of Object.entries(sessions)) {
        if ((row.expires_at || 0) < cutoff) {
          delete sessions[id];
          pruned = true;
        }
      }
      if (pruned) saveSessions();
      return issueSession();

      function issueSession() {
        const id = crypto.randomUUID();
        const expiresAt = Date.now() + SESSION_TTL_MS;
        sessions[id] = { user, expires_at: expiresAt };
        saveSessions();
        return { ok: true, session: id, expiresAt, user };
      }
    },

    validateSession(sessionId) {
      if (typeof sessionId !== 'string' || !sessionId) return { ok: false };
      const row = sessions[sessionId];
      if (!row) return { ok: false };
      if ((row.expires_at || 0) < Date.now()) {
        delete sessions[sessionId];
        saveSessions();
        return { ok: false, reason: 'expired' };
      }
      return { ok: true, user: row.user, expiresAt: row.expires_at };
    },

    logout(sessionId) {
      if (sessionId && sessions[sessionId]) {
        delete sessions[sessionId];
        saveSessions();
      }
      return { ok: true };
    },

    async changePassword(sessionId, currentPassword, newPassword) {
      const session = store.validateSession(sessionId);
      if (!session.ok) return { ok: false, reason: 'unauthenticated' };
      if (!auth) return { ok: false, reason: 'no-password' };
      const currentOk = await verifyPassword(
        String(currentPassword ?? ''),
        auth.salt,
        auth.hash,
        auth.it,
      );
      if (!currentOk) return { ok: false, reason: 'bad-current' };
      const next = String(newPassword ?? '');
      if (next.length < 6) return { ok: false, reason: 'too-short' };
      const hashed = await hashPassword(next);
      auth = { u: auth.u, ...hashed };
      writeJson('auth.json', auth);
      for (const id of Object.keys(sessions)) {
        if (id !== sessionId) delete sessions[id];
      }
      saveSessions();
      return { ok: true };
    },

    recordPublish(result) {
      store.setMeta('last_publish', { at: nowIso(), ...result });
      return { ok: true };
    },

    getLastPublish() {
      return store.getMeta('last_publish');
    },
  };

  return store;
}
