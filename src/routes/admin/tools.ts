import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can, randomToken } from '../../lib/auth';
import { bumpCache, getSettings } from '../../lib/config';
import { SCHEMA_VERSION } from '../../db/migrations';
import { deleteFile, getFile, putFile } from '../../lib/files';
import { safeUrl, slugify } from '../../lib/security';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';
import { APP_VERSION } from '../../lib/version';

/**
 * Tools: redirects, import/export, backups, site health and cache.
 * Everything here is admin-only because exports contain every comment and
 * every post, and imports can overwrite content.
 */
const tools = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'admin')) return errorPage(c, 403, 'Only admins can use the tools.');
  await next();
};
tools.use('/tools', guard);
tools.use('/tools/*', guard);

const MAX_IMPORT = 5 * 1024 * 1024;
const BACKUP_PREFIX = 'backups/';

/* --------------------------------------------------------------- data dump */
type Dump = { results: Record<string, unknown>[] };

async function exportData(c: Ctx): Promise<Record<string, unknown>> {
  const db = c.env.DB;
  // Each query is independent, so a table that has not been migrated yet only
  // leaves that part of the dump empty instead of failing the whole export.
  const query = async (sql: string): Promise<Dump> => {
    try {
      return (await db.prepare(sql).all()) as unknown as Dump;
    } catch {
      return { results: [] };
    }
  };
  const [content, terms, contentTerms, menus, menuItems, redirects, comments, users, settings, site] = await Promise.all([
    query('SELECT * FROM content WHERE site_id=1 ORDER BY id'),
    query('SELECT * FROM terms WHERE site_id=1 ORDER BY id'),
    query('SELECT ct.* FROM content_terms ct JOIN content c ON c.id=ct.content_id WHERE c.site_id=1'),
    query('SELECT * FROM menus WHERE site_id=1 ORDER BY id'),
    query('SELECT i.* FROM menu_items i JOIN menus m ON m.id=i.menu_id WHERE m.site_id=1 ORDER BY i.menu_id, i.position'),
    query('SELECT * FROM redirects WHERE site_id=1 ORDER BY id'),
    query('SELECT id, content_id, parent_id, author_name, author_email, body, status, created_at FROM comments WHERE site_id=1 ORDER BY id'),
    query('SELECT id, username, email, role, created_at FROM users ORDER BY id'),
    query('SELECT key, value FROM settings WHERE site_id=1'),
    query('SELECT id, hostname, name FROM sites WHERE id=1'),
  ]);
  const settingsMap: Record<string, string> = {};
  for (const row of settings.results as { key: string; value: string }[]) settingsMap[row.key] = row.value;
  return {
    format: 'edge-cms-backup',
    app_version: APP_VERSION,
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    site: site.results[0] ?? null,
    settings: settingsMap,
    users: users.results,
    content: content.results,
    terms: terms.results,
    content_terms: contentTerms.results,
    menus: menus.results,
    menu_items: menuItems.results,
    redirects: redirects.results,
    comments: comments.results,
  };
}

const jsonResponse = (data: unknown, filename: string): Response => new Response(JSON.stringify(data, null, 2), {
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  },
});

/* ------------------------------------------------------------------ overview */
tools.get('/tools', async (c) => {
  const base = c.var.base;
  const [redirects, backups, comments] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM redirects WHERE site_id=1').first<{ n: number }>().catch(() => null),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM backups').first<{ n: number }>().catch(() => null),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE site_id=1 AND status='pending'").first<{ n: number }>().catch(() => null),
  ]);
  return layout(c, 'Tools', html`
<h1>Tools</h1>
<div class="grid3">
  <a class="tile" href="${base}/tools/redirects"><b>Redirects</b><span>${redirects?.n ?? 0} rules. Send old URLs to new ones.</span></a>
  <a class="tile" href="${base}/tools/export"><b>Import / Export</b><span>Download your content as JSON or restore it.</span></a>
  <a class="tile" href="${base}/tools/backups"><b>Backups</b><span>${backups?.n ?? 0} stored snapshots you can download.</span></a>
  <a class="tile" href="${base}/tools/health"><b>Site Health</b><span>Database, storage, versions and counts.</span></a>
  <a class="tile" href="${base}/comments"><b>Comments</b><span>${comments?.n ?? 0} waiting for moderation.</span></a>
  <a class="tile" href="${base}/settings"><b>Settings</b><span>Site title, reading, discussion, domains.</span></a>
</div>
<div class="card" style="margin-top:1rem">
  <h2>Danger zone</h2>
  <p class="hint" style="margin-top:0">Deleting the cache does not touch content. Pages are rebuilt on the next visit.</p>
  <form method="post" action="${base}/tools/cache">${csrfField(c)}<button class="btn ghost small" type="submit">Delete page cache</button></form>
</div>`, '/tools');
});

/* ----------------------------------------------------------------- redirects */
tools.get('/tools/redirects', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, from_path, to_url, status FROM redirects WHERE site_id=1 ORDER BY from_path')
    .all<{ id: number; from_path: string; to_url: string; status: number }>();
  const base = c.var.base;
  return layout(c, 'Redirects', html`
<div class="row between" style="margin-bottom:1rem"><h1 style="margin:0">Redirects</h1><a href="${base}/tools">&larr; Tools</a></div>
<form method="post" action="${base}/tools/redirects" class="card">
  ${csrfField(c)}
  <h2>Add a redirect</h2>
  <div class="grid2">
    <div><label for="from_path" style="margin-top:0">Old path</label><input type="text" id="from_path" name="from_path" placeholder="/old-page" required maxlength="300" autocapitalize="none"></div>
    <div><label for="to_url" style="margin-top:0">New path or URL</label><input type="text" id="to_url" name="to_url" placeholder="/new-page or https://example.com" required maxlength="500" autocapitalize="none"></div>
  </div>
  <label for="status">Type</label>
  <select id="status" name="status"><option value="301">301 — permanent</option><option value="302">302 — temporary</option></select>
  <p style="margin:1rem 0 0"><button class="btn" type="submit">Save redirect</button></p>
</form>
<div class="card">
  ${results.length ? html`<table class="table">
    <thead><tr><th>From</th><th>To</th><th>Type</th><th></th></tr></thead>
    <tbody>
      ${results.map((r) => html`<tr>
        <td><code>${r.from_path}</code></td>
        <td><a href="${r.to_url}" target="_blank" rel="noopener">${r.to_url}</a></td>
        <td><span class="pill off">${r.status}</span></td>
        <td class="actions"><form method="post" action="${base}/tools/redirects/${r.id}/delete" class="inline" data-confirm>${csrfField(c)}<button class="btn danger small" type="submit">Delete</button></form></td>
      </tr>`)}
    </tbody>
  </table>` : html`<p class="muted" style="margin:0">No redirects yet.</p>`}
</div>
${raw(`<script>document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm('Delete this redirect?'))e.preventDefault()})});</script>`)}`, '/tools/redirects');
});

tools.post('/tools/redirects', async (c) => {
  const rawPath = String(c.var.form.get('from_path') ?? '').trim();
  const from = '/' + rawPath.replace(/^\/+/, '');
  const to = safeUrl(String(c.var.form.get('to_url') ?? '').trim());
  const status = c.var.form.get('status') === '302' ? 302 : 301;
  if (!/^\/[^\s?#]{1,300}$/.test(from)) return go(c, '/tools/redirects', { err: 'The old path must start with / and contain no spaces, ? or #.' });
  if (!to) return go(c, '/tools/redirects', { err: 'Enter a valid destination path or URL.' });
  if (from === to) return go(c, '/tools/redirects', { err: 'A page cannot redirect to itself.' });
  await c.env.DB.prepare(
    'INSERT INTO redirects (site_id, from_path, to_url, status) VALUES (1,?,?,?) ON CONFLICT(site_id, from_path) DO UPDATE SET to_url=excluded.to_url, status=excluded.status',
  ).bind(from, to, status).run();
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/tools/redirects', { ok: `${from} → ${to} saved.` });
});

tools.post('/tools/redirects/:id{[0-9]+}/delete', async (c) => {
  await c.env.DB.prepare('DELETE FROM redirects WHERE id=? AND site_id=1').bind(Number(c.req.param('id'))).run();
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/tools/redirects', { ok: 'Redirect deleted.' });
});

/* ------------------------------------------------------------- import/export */
tools.get('/tools/export', async (c) => {
  const base = c.var.base;
  return layout(c, 'Import / Export', html`
<div class="row between" style="margin-bottom:1rem"><h1 style="margin:0">Import / Export</h1><a href="${base}/tools">&larr; Tools</a></div>
<div class="card">
  <h2>Export</h2>
  <p class="hint" style="margin-top:0">One JSON file with your pages, posts, categories, tags, menus, comments, redirects, settings and user list (without passwords). Keep it somewhere safe.</p>
  <p style="margin:0"><a class="btn" href="${base}/tools/export/download">Download export</a></p>
</div>
<form method="post" action="${base}/tools/import" enctype="multipart/form-data" class="card">
  ${csrfField(c)}
  <h2>Import</h2>
  <p class="hint" style="margin-top:0">Upload a file made by Export. Content is merged by type and slug: existing pages and posts are updated, new ones are created. Categories, tags, menus, redirects and comments are added. Users, themes and settings are not imported.</p>
  <label for="file">Backup file (.json)</label>
  <input type="file" id="file" name="file" accept=".json,application/json" required>
  <p class="hint">Up to 5 MB.</p>
  <p style="margin:1rem 0 0"><button class="btn" type="submit">Import file</button></p>
</form>`, '/tools/export');
});

tools.get('/tools/export/download', async (c) => {
  const stamp = new Date().toISOString().slice(0, 10);
  return jsonResponse(await exportData(c), `edge-cms-export-${stamp}.json`);
});

type ImportResult = { content: number; terms: number; menus: number; redirects: number; comments: number };

async function importData(c: Ctx, payload: any): Promise<ImportResult> {
  const db = c.env.DB;
  const out: ImportResult = { content: 0, terms: 0, menus: 0, redirects: 0, comments: 0 };
  const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);
  const now = new Date().toISOString();
  const contentMap = new Map<number, number>();

  for (const row of Array.isArray(payload.content) ? payload.content.slice(0, 5000) : []) {
    const type = row?.type === 'post' ? 'post' : 'page';
    const title = str(row?.title, 200).trim() || '(untitled)';
    const slug = slugify(str(row?.slug, 80) || title) || `${type}-${Math.random().toString(36).slice(2, 8)}`;
    const status = ['draft', 'published', 'scheduled'].includes(row?.status) ? row.status : 'draft';
    const publishedAt = row?.published_at ? new Date(row.published_at).toISOString() : null;
    const existing = await db.prepare('SELECT id FROM content WHERE site_id=1 AND type=? AND slug=?').bind(type, slug)
      .first<{ id: number }>();
    if (existing) {
      await db.prepare('UPDATE content SET title=?, body=?, excerpt=?, status=?, seo_title=?, seo_description=?, published_at=?, updated_at=? WHERE id=?')
        .bind(title, str(row?.body, 200000), str(row?.excerpt, 500), status, str(row?.seo_title, 200), str(row?.seo_description, 320), publishedAt, now, existing.id).run();
      contentMap.set(Number(row?.id), existing.id);
    } else {
      const res = await db.prepare(
        'INSERT INTO content (site_id,type,title,slug,body,excerpt,status,seo_title,seo_description,author_id,published_at,created_at,updated_at) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(type, title, slug, str(row?.body, 200000), str(row?.excerpt, 500), status, str(row?.seo_title, 200), str(row?.seo_description, 320), c.var.user.id, publishedAt, now, now).run();
      contentMap.set(Number(row?.id), Number(res.meta.last_row_id));
    }
    out.content++;
  }

  const termMap = new Map<number, number>();
  for (const row of Array.isArray(payload.terms) ? payload.terms.slice(0, 5000) : []) {
    const taxonomy = row?.taxonomy === 'tag' ? 'tag' : 'category';
    const name = str(row?.name, 60).trim();
    const slug = slugify(str(row?.slug, 80) || name);
    if (!name || !slug) continue;
    await db.prepare('INSERT OR IGNORE INTO terms (site_id,taxonomy,name,slug) VALUES (1,?,?,?)').bind(taxonomy, name, slug).run();
    const found = await db.prepare('SELECT id FROM terms WHERE site_id=1 AND taxonomy=? AND slug=?').bind(taxonomy, slug)
      .first<{ id: number }>();
    if (found) {
      termMap.set(Number(row?.id), found.id);
      out.terms++;
    }
  }

  for (const row of Array.isArray(payload.content_terms) ? payload.content_terms.slice(0, 20000) : []) {
    const contentId = contentMap.get(Number(row?.content_id));
    const termId = termMap.get(Number(row?.term_id));
    if (contentId && termId) {
      await db.prepare('INSERT OR IGNORE INTO content_terms (content_id,term_id) VALUES (?,?)').bind(contentId, termId).run();
    }
  }

  for (const row of Array.isArray(payload.menus) ? payload.menus.slice(0, 100) : []) {
    const name = str(row?.name, 120).trim();
    if (!name) continue;
    let menu = await db.prepare('SELECT id FROM menus WHERE site_id=1 AND name=?').bind(name).first<{ id: number }>();
    if (!menu) {
      const res = await db.prepare('INSERT INTO menus (site_id,name,location) VALUES (1,?,\'\')').bind(name).run();
      menu = { id: Number(res.meta.last_row_id) };
    }
    out.menus++;
  }

  for (const row of Array.isArray(payload.menu_items) ? payload.menu_items.slice(0, 5000) : []) {
    const sourceMenu = (Array.isArray(payload.menus) ? payload.menus : []).find((m: any) => Number(m?.id) === Number(row?.menu_id));
    const label = str(row?.label, 80).trim();
    const url = safeUrl(str(row?.url, 500).trim());
    if (!sourceMenu || !label || !url) continue;
    const menu = await db.prepare('SELECT id FROM menus WHERE site_id=1 AND name=?').bind(str(sourceMenu.name, 120)).first<{ id: number }>();
    if (!menu) continue;
    const dup = await db.prepare('SELECT 1 AS x FROM menu_items WHERE menu_id=? AND url=? AND label=?').bind(menu.id, url, label).first();
    if (dup) continue;
    const pos = await db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM menu_items WHERE menu_id=?').bind(menu.id).first<{ n: number }>();
    await db.prepare('INSERT INTO menu_items (menu_id,label,url,position) VALUES (?,?,?,?)').bind(menu.id, label, url, Number(pos?.n || 0)).run();
  }

  for (const row of Array.isArray(payload.redirects) ? payload.redirects.slice(0, 1000) : []) {
    const from = str(row?.from_path, 300).trim();
    const to = safeUrl(str(row?.to_url, 500).trim());
    if (!/^\/[^\s?#]{1,300}$/.test(from) || !to) continue;
    await db.prepare('INSERT OR IGNORE INTO redirects (site_id,from_path,to_url,status) VALUES (1,?,?,?)')
      .bind(from, to, Number(row?.status) === 302 ? 302 : 301).run();
    out.redirects++;
  }

  for (const row of Array.isArray(payload.comments) ? payload.comments.slice(0, 20000) : []) {
    const contentId = contentMap.get(Number(row?.content_id));
    if (!contentId) continue;
    const status = ['pending', 'approved', 'spam', 'trash'].includes(row?.status) ? row.status : 'pending';
    const author = str(row?.author_name, 80) || 'Anonymous';
    const email = str(row?.author_email, 160);
    const body = str(row?.body, 4000);
    if (!body) continue;
    // Importing the same file twice must not duplicate comments.
    const dup = await db.prepare('SELECT 1 AS x FROM comments WHERE content_id=? AND author_name=? AND body=? LIMIT 1')
      .bind(contentId, author, body).first();
    if (dup) continue;
    await db.prepare(
      'INSERT INTO comments (site_id,content_id,parent_id,author_name,author_email,body,status,created_at,updated_at) VALUES (1,?,NULL,?,?,?,?,?,?)',
    ).bind(contentId, author, email, body, status, row?.created_at ? String(row.created_at) : now, now).run();
    out.comments++;
  }

  return out;
}

tools.post('/tools/import', async (c) => {
  const file = c.var.form.get('file');
  if (!file || typeof file === 'string' || !file.size) return go(c, '/tools/export', { err: 'Choose an export file to import.' });
  if (file.size > MAX_IMPORT) return go(c, '/tools/export', { err: 'That file is larger than 5 MB.' });
  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(await file.arrayBuffer()));
  } catch {
    return go(c, '/tools/export', { err: 'That file is not valid JSON.' });
  }
  if (!payload || payload.format !== 'edge-cms-backup') return go(c, '/tools/export', { err: 'That is not an Edge CMS export file.' });
  try {
    const res = await importData(c, payload);
    await bumpCache(c.env, c.var.cfg);
    return go(c, '/tools/export', {
      ok: `Imported ${res.content} pages/posts, ${res.terms} terms, ${res.menus} menus, ${res.redirects} redirects and ${res.comments} comments.`,
    });
  } catch (err) {
    console.error(err);
    return go(c, '/tools/export', { err: 'The import failed part-way. Check the file and try again.' });
  }
});

/* ------------------------------------------------------------------ backups */
tools.get('/tools/backups', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, r2_key, size, created_at FROM backups ORDER BY id DESC LIMIT 50')
    .all<{ id: number; r2_key: string; size: number; created_at: string }>();
  const base = c.var.base;
  const kb = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  return layout(c, 'Backups', html`
<div class="row between" style="margin-bottom:1rem"><h1 style="margin:0">Backups</h1><a href="${base}/tools">&larr; Tools</a></div>
<div class="card">
  <h2>Create a backup</h2>
  <p class="hint" style="margin-top:0">A backup is the same JSON as an export, stored on the server so you can download it later. Passwords and theme files are not included.</p>
  <form method="post" action="${base}/tools/backups/create">${csrfField(c)}<button class="btn" type="submit">Create backup now</button></form>
</div>
<div class="card">
  <h2>Stored backups</h2>
  ${results.length ? html`<table class="table">
    <thead><tr><th>Created</th><th>Size</th><th></th></tr></thead>
    <tbody>${results.map((b) => html`<tr>
      <td>${b.created_at.slice(0, 16).replace('T', ' ')} UTC</td>
      <td>${kb(b.size)}</td>
      <td class="actions">
        <a class="btn ghost small" href="${base}/tools/backups/${b.id}/download">Download</a>
        <form method="post" action="${base}/tools/backups/${b.id}/delete" class="inline" data-confirm>${csrfField(c)}<button class="btn danger small" type="submit">Delete</button></form>
      </td>
    </tr>`)}</tbody>
  </table>` : html`<p class="muted" style="margin:0">No backups yet.</p>`}
</div>
${raw(`<script>document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm('Delete this backup permanently?'))e.preventDefault()})});</script>`)}`, '/tools/backups');
});

tools.post('/tools/backups/create', async (c) => {
  const data = await exportData(c);
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const key = `${BACKUP_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}-${randomToken(4)}.json`;
  await putFile(c.env, key, bytes.buffer as ArrayBuffer, 'application/json');
  await c.env.DB.prepare('INSERT INTO backups (r2_key, size, created_at) VALUES (?,?,?)')
    .bind(key, bytes.byteLength, new Date().toISOString()).run();
  return go(c, '/tools/backups', { ok: 'Backup created. Download it and keep a copy off the server.' });
});

async function backupById(c: Ctx, id: number) {
  return c.env.DB.prepare('SELECT id, r2_key FROM backups WHERE id=?').bind(id).first<{ id: number; r2_key: string }>();
}

tools.get('/tools/backups/:id{[0-9]+}/download', async (c) => {
  const row = await backupById(c, Number(c.req.param('id')));
  if (!row || !row.r2_key.startsWith(BACKUP_PREFIX)) return errorPage(c, 404, 'Backup not found.');
  const file = await getFile(c.env, row.r2_key);
  if (!file) return errorPage(c, 404, 'The backup file is missing.');
  return new Response(file.body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${row.r2_key.split('/').pop()}"`,
      'Cache-Control': 'no-store',
    },
  });
});

tools.post('/tools/backups/:id{[0-9]+}/delete', async (c) => {
  const row = await backupById(c, Number(c.req.param('id')));
  if (!row) return errorPage(c, 404, 'Backup not found.');
  if (row.r2_key.startsWith(BACKUP_PREFIX)) await deleteFile(c.env, row.r2_key);
  await c.env.DB.prepare('DELETE FROM backups WHERE id=?').bind(row.id).run();
  return go(c, '/tools/backups', { ok: 'Backup deleted.' });
});

/* -------------------------------------------------------------- site health */
tools.get('/tools/health', async (c) => {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  let dbOk = false;
  try {
    await c.env.DB.prepare('SELECT 1 AS x').first();
    dbOk = true;
  } catch { /* reported below */ }
  checks.push({ name: 'Database (D1 / SQLite)', ok: dbOk, detail: dbOk ? 'Queries run normally.' : 'The database did not answer.' });

  let kvOk = false;
  try {
    await c.env.KV.get('health-check');
    kvOk = true;
  } catch { /* reported below */ }
  checks.push({ name: 'Key-value store (cache and config)', ok: kvOk, detail: kvOk ? 'Reading works.' : 'The key-value store did not answer.' });

  let mediaOk = false;
  try {
    await getFile(c.env, 'health-check/none');
    mediaOk = true;
  } catch { /* reported below */ }
  checks.push({ name: 'Media storage', ok: mediaOk, detail: mediaOk ? (c.env.FILES ? 'Files are on disk (data/media).' : 'Files are in KV.') : 'Media storage did not answer.' });

  const count = async (sql: string) => Number((await c.env.DB.prepare(sql).first<{ n: number }>().catch(() => null))?.n || 0);
  const [pages, posts, drafts, media, usersCount, commentCount, redirects, hooks, backups, settings] = await Promise.all([
    count("SELECT COUNT(*) AS n FROM content WHERE site_id=1 AND type='page'"),
    count("SELECT COUNT(*) AS n FROM content WHERE site_id=1 AND type='post' AND status='published'"),
    count("SELECT COUNT(*) AS n FROM content WHERE site_id=1 AND status<>'published'"),
    count('SELECT COUNT(*) AS n FROM media WHERE site_id=1'),
    count('SELECT COUNT(*) AS n FROM users'),
    count('SELECT COUNT(*) AS n FROM comments WHERE site_id=1'),
    count('SELECT COUNT(*) AS n FROM redirects WHERE site_id=1'),
    count('SELECT COUNT(*) AS n FROM hooks WHERE site_id=1'),
    count('SELECT COUNT(*) AS n FROM backups'),
    getSettings(c.env),
  ]);
  const dbVersion = Number(settings.schema_version || 1);
  const runtime = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers' ? 'Cloudflare Workers' : 'Node.js';
  const base = c.var.base;
  return layout(c, 'Site Health', html`
<div class="row between" style="margin-bottom:1rem"><h1 style="margin:0">Site Health</h1><a href="${base}/tools">&larr; Tools</a></div>
<div class="card">
  <h2>Status</h2>
  <ul class="list">
    ${checks.map((ch) => html`<li><div class="t"><b>${ch.name}</b><small>${ch.detail}</small></div><span class="${ch.ok ? 'pos' : 'neg'}">${ch.ok ? 'OK' : 'Problem'}</span></li>`)}
  </ul>
</div>
<div class="card">
  <h2>Versions</h2>
  <dl class="kv">
    <dt>CMS version</dt><dd>${APP_VERSION}</dd>
    <dt>Database schema</dt><dd>${dbVersion} ${dbVersion === SCHEMA_VERSION ? '(up to date)' : `(latest is ${SCHEMA_VERSION} — open <a href="${base}/updates">Updates</a>)`}</dd>
    <dt>Runtime</dt><dd>${runtime}</dd>
    <dt>Timezone</dt><dd>${settings.timezone || 'UTC'}</dd>
    <dt>Installed</dt><dd>${(settings.installed_at || '').slice(0, 10) || 'unknown'}</dd>
    <dt>Cache generation</dt><dd>${new Date(c.var.cfg.cacheV).toISOString().replace('T', ' ').slice(0, 19)} UTC</dd>
  </dl>
  <form method="post" action="${base}/tools/cache" style="margin-top:.9rem">${csrfField(c)}<button class="btn ghost small" type="submit">Delete page cache</button></form>
</div>
<div class="card">
  <h2>Content</h2>
  <dl class="kv">
    <dt>Pages</dt><dd>${pages}</dd>
    <dt>Published posts</dt><dd>${posts}</dd>
    <dt>Drafts and scheduled</dt><dd>${drafts}</dd>
    <dt>Media files</dt><dd>${media}</dd>
    <dt>Users</dt><dd>${usersCount}</dd>
    <dt>Comments</dt><dd>${commentCount}</dd>
    <dt>Redirects</dt><dd>${redirects}</dd>
    <dt>Plugins</dt><dd>${hooks}</dd>
    <dt>Backups</dt><dd>${backups}</dd>
  </dl>
  <p class="hint" style="margin-bottom:0">Uptime monitors can use <a href="/api/health">/api/health</a>, which answers before the installer runs.</p>
</div>`, '/tools/health');
});

tools.post('/tools/cache', async (c) => {
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/tools/health', { ok: 'Page cache cleared. Every page is rebuilt on the next visit.' });
});

export default tools;
