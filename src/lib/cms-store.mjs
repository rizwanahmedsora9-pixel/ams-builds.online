// Built-in client-side CMS store + hardcoded authentication.
// Persists content overrides in localStorage and uploaded images in IndexedDB
// (with automatic localStorage fallback when IndexedDB is unavailable).
import { defaultSettings, isValidSlug, validateEntry, validateSettings } from './fields.mjs';
import { mergeEntries, mergeSettings } from './merge.mjs';
import { mediaFileName } from './slug.mjs';
import { normalizeYamlValues, serializeDataFile, serializeFrontmatter } from './yaml.mjs';

export const AUTH_USER = 'admin';
export const AUTH_PASS = 'admin12345';

export const SESSION_STORAGE_KEY = 'ams_cms_session_v1';
export const STORE_STORAGE_KEY = 'ams_cms_store_v1';
export const MEDIA_FALLBACK_KEY = 'ams_cms_media_v1';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_MEDIA_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MEDIA_PATH_RE = /^\/images\/uploads\/[A-Za-z0-9._-]+$/;
const CONTENT_TYPES = ['blog', 'pages', 'projects'];

function entryKey(type, slug) {
  return `${type}:${slug}`;
}

function nowIso() {
  return new Date().toISOString();
}

function emptyStore() {
  return { version: 1, entries: {}, settings: null, updated_at: null };
}

function defaultStorage() {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function createIdbMediaBackend(storage) {
  const DB_NAME = 'ams_cms_media_db';
  const STORE_NAME = 'images';

  function hasIdb() {
    return typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined';
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = globalThis.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'path' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  function readFallback() {
    try {
      const parsed = JSON.parse(storage.getItem(MEDIA_FALLBACK_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeFallback(data) {
    storage.setItem(MEDIA_FALLBACK_KEY, JSON.stringify(data));
  }

  return {
    async list() {
      if (!hasIdb()) {
        return Object.values(readFallback()).sort((a, b) =>
          (a.updated_at || '') < (b.updated_at || '') ? 1 : -1,
        );
      }
      try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).getAll();
          req.onsuccess = () => {
            const list = (req.result || []).sort((a, b) =>
              (a.updated_at || '') < (b.updated_at || '') ? 1 : -1,
            );
            resolve(list);
          };
          req.onerror = () => reject(req.error);
        });
      } catch {
        return Object.values(readFallback());
      }
    },
    async get(path) {
      if (!hasIdb()) return readFallback()[path] || null;
      try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(path);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      } catch {
        return readFallback()[path] || null;
      }
    },
    async put(item) {
      if (!hasIdb()) {
        const all = readFallback();
        all[item.path] = item;
        writeFallback(all);
        return;
      }
      try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(item);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch {
        const all = readFallback();
        all[item.path] = item;
        writeFallback(all);
      }
    },
    async remove(path) {
      if (!hasIdb()) {
        const all = readFallback();
        const existed = Boolean(all[path]);
        delete all[path];
        writeFallback(all);
        return existed;
      }
      try {
        const existing = await this.get(path);
        const db = await openDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(path);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        return Boolean(existing);
      } catch {
        const all = readFallback();
        const existed = Boolean(all[path]);
        delete all[path];
        writeFallback(all);
        return existed;
      }
    },
    async clear() {
      storage.removeItem(MEDIA_FALLBACK_KEY);
      if (!hasIdb()) return;
      try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch {
        /* ignore */
      }
    },
  };
}

export function createClientCms({ baseline = {}, storage = defaultStorage(), mediaBackend } = {}) {
  const baseEntries = Array.isArray(baseline.entries)
    ? baseline.entries.map((e) => ({
        slug: e.slug,
        type: e.type,
        data: normalizeYamlValues(e.data || {}),
        body: e.body || '',
        source: 'file',
      }))
    : [];
  const baseSettings = mergeSettings(defaultSettings(), normalizeYamlValues(baseline.settings || {}));
  const baseMedia = Array.isArray(baseline.media) ? baseline.media : [];
  const mediaDb = mediaBackend || createIdbMediaBackend(storage);

  function readStore() {
    try {
      const raw = storage.getItem(STORE_STORAGE_KEY);
      if (!raw) return emptyStore();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return emptyStore();
      return {
        version: 1,
        entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
        settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : null,
        updated_at: parsed.updated_at || null,
      };
    } catch {
      return emptyStore();
    }
  }

  function writeStore(state) {
    const hasEntries = Object.keys(state.entries || {}).length > 0;
    const hasSettings = Boolean(state.settings);
    if (!hasEntries && !hasSettings) {
      storage.removeItem(STORE_STORAGE_KEY);
      return;
    }
    state.updated_at = nowIso();
    storage.setItem(STORE_STORAGE_KEY, JSON.stringify(state));
  }

  // ── authentication (hardcoded admin / admin12345) ───────────────────────
  function getSession() {
    try {
      const raw = storage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return { authenticated: false };
      const data = JSON.parse(raw);
      if (!data || data.user !== AUTH_USER || !data.expiresAt || data.expiresAt < Date.now()) {
        storage.removeItem(SESSION_STORAGE_KEY);
        return { authenticated: false };
      }
      return { authenticated: true, user: data.user, expiresAt: data.expiresAt };
    } catch {
      return { authenticated: false };
    }
  }

  function login(username, password) {
    const user = String(username ?? '').trim();
    const pass = String(password ?? '');
    if (!user || !pass) {
      return { ok: false, reason: 'missing', error: 'Enter your username and password.' };
    }
    if (user !== AUTH_USER || pass !== AUTH_PASS) {
      return { ok: false, reason: 'bad-credentials', error: 'Invalid username or password.' };
    }
    const expiresAt = Date.now() + SESSION_TTL_MS;
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ user: AUTH_USER, expiresAt }));
    return { ok: true, user: AUTH_USER, expiresAt };
  }

  function logout() {
    storage.removeItem(SESSION_STORAGE_KEY);
    return { ok: true };
  }

  // ── content CRUD ────────────────────────────────────────────────────────
  function getMergedEntries(type = null) {
    const store = readStore();
    const overrides = Object.values(store.entries || {});
    const merged = mergeEntries(baseEntries, overrides).map((entry) => {
      const override = store.entries[entryKey(entry.type, entry.slug)];
      return {
        ...entry,
        source: override ? 'cms' : 'file',
        hasBaseline: baseEntries.some((b) => b.type === entry.type && b.slug === entry.slug),
        updated_at: override?.updated_at || null,
      };
    });
    return type ? merged.filter((e) => e.type === type) : merged;
  }

  function listContent(type) {
    if (!CONTENT_TYPES.includes(type)) return [];
    return getMergedEntries(type).sort((a, b) => {
      const da = a.data?.date || a.data?.pubDate || '';
      const db = b.data?.date || b.data?.pubDate || '';
      if (da !== db) return db < da ? -1 : 1;
      return (a.data?.title || '').localeCompare(b.data?.title || '');
    });
  }

  function getEntry(type, slug) {
    if (!CONTENT_TYPES.includes(type) || !slug) return null;
    const store = readStore();
    const override = store.entries[entryKey(type, slug)];
    if (override) {
      if (override.deleted) return null;
      return {
        type,
        slug,
        data: override.frontmatter || {},
        body: override.body || '',
        source: 'cms',
        hasBaseline: baseEntries.some((b) => b.type === type && b.slug === slug),
        updated_at: override.updated_at,
      };
    }
    const base = baseEntries.find((e) => e.type === type && e.slug === slug);
    if (!base) return null;
    return {
      type,
      slug,
      data: { ...base.data },
      body: base.body,
      source: 'file',
      hasBaseline: true,
      updated_at: null,
    };
  }

  function saveEntry(type, slug, data, body = '') {
    if (!CONTENT_TYPES.includes(type)) {
      return { ok: false, errors: [`Unknown content type "${type}"`] };
    }
    if (!isValidSlug(slug)) {
      return { ok: false, errors: ['Pick a valid URL slug (lowercase letters, numbers and dashes)'] };
    }
    const cleanData = normalizeYamlValues(data || {});
    const cleanBody = typeof body === 'string' ? body : '';
    const errors = validateEntry(type, cleanData, cleanBody);
    if (errors.length) return { ok: false, errors };

    const store = readStore();
    const updated_at = nowIso();
    store.entries[entryKey(type, slug)] = {
      type,
      slug,
      frontmatter: cleanData,
      body: cleanBody,
      updated_at,
      deleted: false,
    };
    writeStore(store);
    return { ok: true, slug, updated_at };
  }

  function deleteEntry(type, slug) {
    if (!CONTENT_TYPES.includes(type) || !isValidSlug(slug)) {
      return { ok: false, error: 'Bad entry' };
    }
    const store = readStore();
    const key = entryKey(type, slug);
    const existsInBase = baseEntries.some((e) => e.type === type && e.slug === slug);
    if (existsInBase) {
      store.entries[key] = {
        type,
        slug,
        frontmatter: {},
        body: '',
        updated_at: nowIso(),
        deleted: true,
      };
    } else {
      delete store.entries[key];
    }
    writeStore(store);
    return { ok: true };
  }

  function revertEntry(type, slug) {
    const store = readStore();
    delete store.entries[entryKey(type, slug)];
    writeStore(store);
    return { ok: true };
  }

  // ── settings CRUD ───────────────────────────────────────────────────────
  function getSettings() {
    const store = readStore();
    if (store.settings?.data) {
      return {
        type: 'settings',
        slug: 'site',
        data: mergeSettings(baseSettings, store.settings.data),
        source: 'cms',
        updated_at: store.settings.updated_at || null,
      };
    }
    return {
      type: 'settings',
      slug: 'site',
      data: { ...baseSettings },
      source: 'file',
      updated_at: null,
    };
  }

  function saveSettings(data) {
    const cleanData = normalizeYamlValues(data || {});
    const errors = validateSettings(cleanData);
    if (errors.length) return { ok: false, errors };

    const store = readStore();
    const updated_at = nowIso();
    store.settings = { data: cleanData, updated_at };
    writeStore(store);
    return { ok: true, slug: 'site', updated_at };
  }

  function revertSettings() {
    const store = readStore();
    store.settings = null;
    writeStore(store);
    return { ok: true };
  }

  // ── media CRUD ──────────────────────────────────────────────────────────
  async function listMedia() {
    const uploaded = await mediaDb.list();
    const byPath = new Map();
    for (const item of baseMedia) {
      byPath.set(item.path, { ...item, url: item.path, source: 'repo' });
    }
    for (const item of uploaded) {
      byPath.set(item.path, { ...item, url: item.dataUrl || item.path, source: 'cms' });
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  async function resolveMediaUrl(path) {
    if (!path || typeof path !== 'string') return '';
    if (!MEDIA_PATH_RE.test(path)) return path;
    const item = await mediaDb.get(path);
    return item?.dataUrl || path;
  }

  async function resolveAllMediaMap() {
    const uploaded = await mediaDb.list();
    const map = {};
    for (const item of uploaded) {
      if (item.path && item.dataUrl) map[item.path] = item.dataUrl;
    }
    return map;
  }

  async function uploadMedia({ name, type, size, dataUrl }) {
    if (!ALLOWED_IMAGE_MIME.includes(type)) {
      return { ok: false, error: 'Only JPG, PNG, WebP or GIF images are allowed' };
    }
    if (!size || size <= 0) {
      return { ok: false, error: 'The file is empty' };
    }
    if (size > MAX_MEDIA_BYTES) {
      return { ok: false, error: 'Image is larger than 4 MB — resize it first' };
    }
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return { ok: false, error: 'Invalid image payload' };
    }
    const existing = new Set((await listMedia()).map((m) => m.path.split('/').pop()));
    const safeName = mediaFileName(name || 'image.jpg', existing);
    const path = `/images/uploads/${safeName}`;
    const updated_at = nowIso();
    await mediaDb.put({ path, mime: type, size, updated_at, dataUrl });
    return { ok: true, path, url: dataUrl, size, updated_at };
  }

  async function deleteMedia(path) {
    if (!MEDIA_PATH_RE.test(path || '')) {
      return { ok: false, error: 'Bad path' };
    }
    const existed = await mediaDb.remove(path);
    return { ok: true, existed };
  }

  // ── status, export, import, reset ───────────────────────────────────────
  async function getStatus() {
    const store = readStore();
    const blog = listContent('blog');
    const pages = listContent('pages');
    const projects = listContent('projects');
    const media = await listMedia();
    const uploadedMedia = media.filter((m) => m.source === 'cms');
    const overrideCount = Object.keys(store.entries || {}).length + (store.settings ? 1 : 0);

    return {
      user: AUTH_USER,
      store: 'client',
      counts: {
        blog: blog.length,
        pages: pages.length,
        projects: projects.length,
      },
      mediaCount: media.length,
      uploadedMediaCount: uploadedMedia.length,
      overrideCount,
      hasOverrides: overrideCount > 0 || uploadedMedia.length > 0,
      updatedAt: store.updated_at,
    };
  }

  function listOverrides() {
    const store = readStore();
    const items = [];
    for (const row of Object.values(store.entries || {})) {
      items.push({
        kind: row.deleted ? 'deleted' : baseEntries.some((b) => b.type === row.type && b.slug === row.slug) ? 'edited' : 'created',
        type: row.type,
        slug: row.slug,
        updated_at: row.updated_at,
        title: row.frontmatter?.title || row.slug,
      });
    }
    if (store.settings) {
      items.push({
        kind: 'edited',
        type: 'settings',
        slug: 'site',
        updated_at: store.settings.updated_at,
        title: 'Site Settings',
      });
    }
    return items.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  function formatEntryMarkdown(type, slug) {
    const entry = getEntry(type, slug);
    if (!entry) return null;
    return serializeFrontmatter(entry.data, entry.body);
  }

  function formatSettingsYaml() {
    return serializeDataFile(getSettings().data);
  }

  async function exportBackup() {
    const store = readStore();
    const uploadedMedia = await mediaDb.list();
    return {
      version: 1,
      exported_at: nowIso(),
      store,
      media: uploadedMedia,
    };
  }

  async function importBackup(payload) {
    if (!payload || typeof payload !== 'object' || !payload.store) {
      return { ok: false, error: 'Invalid backup file' };
    }
    const incomingStore = payload.store;
    const nextStore = {
      version: 1,
      entries: incomingStore.entries && typeof incomingStore.entries === 'object' ? incomingStore.entries : {},
      settings: incomingStore.settings && typeof incomingStore.settings === 'object' ? incomingStore.settings : null,
      updated_at: nowIso(),
    };
    writeStore(nextStore);
    if (Array.isArray(payload.media)) {
      for (const item of payload.media) {
        if (item && MEDIA_PATH_RE.test(item.path || '') && typeof item.dataUrl === 'string') {
          await mediaDb.put({
            path: item.path,
            mime: item.mime || 'image/jpeg',
            size: Number(item.size) || item.dataUrl.length,
            updated_at: item.updated_at || nowIso(),
            dataUrl: item.dataUrl,
          });
        }
      }
    }
    return { ok: true };
  }

  async function resetAll() {
    storage.removeItem(STORE_STORAGE_KEY);
    await mediaDb.clear();
    return { ok: true };
  }

  return {
    getSession,
    login,
    logout,
    listContent,
    getEntry,
    saveEntry,
    deleteEntry,
    revertEntry,
    getSettings,
    saveSettings,
    revertSettings,
    listMedia,
    resolveMediaUrl,
    resolveAllMediaMap,
    uploadMedia,
    deleteMedia,
    getStatus,
    listOverrides,
    formatEntryMarkdown,
    formatSettingsYaml,
    exportBackup,
    importBackup,
    resetAll,
  };
}
