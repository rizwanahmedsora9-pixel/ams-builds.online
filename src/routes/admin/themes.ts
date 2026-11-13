import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { bumpCache, getSettings, setSettings, type Settings } from '../../lib/config';
import { MAX_THEME_ASSET, MAX_THEME_UPLOAD, ThemeError, readUpload, saveTheme } from '../../lib/themes';
import {
  MAX_ASSETS_PER_THEME, assetMime, cleanAssetPath, isRefusedAsset, parseManifest, resolveSettings, settingDefaults,
  validateThemeSettingValue,
  type ThemeManifest, type ThemeSetting, type UploadedAsset,
} from '../../lib/theme-manifest';
import {
  assetCount, assetLimitReached, getThemeAsset, indexAsset, listThemeAssets, listThemeVersions, loadTheme,
  putThemeAsset, recordThemeVersion, restoreThemeVersion, themeAssetUrl, unindexAssets, type StoredTheme,
} from '../../lib/theme-store';
import { zipFiles } from '../../lib/zip';
import { readTokens, tokensCss } from '../../lib/tokens';
import { t } from '../../lib/i18n';
import { esc, slugify } from '../../lib/security';
import { audit } from '../../lib/audit';
import { hasTable } from '../../lib/schema';
import { inspectTemplate } from '../../lib/template';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';
import { card, emptyState, notice } from '../../admin/components';
import { storeThemes, type StoreTheme } from '../../themes';
import { themeFailureFor } from '../../lib/render';
import { clearThemeValueCache } from '../public';

/** Themes contain raw HTML and optional scripts, so everything here is admin-only. */
const themes = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'manage_themes')) return errorPage(c, 403, 'Only admins can manage themes.');
  await next();
};
themes.use('/themes', guard);
themes.use('/themes/*', guard);

/**
 * A store card's screenshot: the file the theme ships (bundled or installed),
 * or '' so the caller falls back to a palette gradient.
 */
function storeScreenshot(st: StoreTheme, installedPaths: string[], installed: boolean): string {
  const path = st.manifest.screenshot;
  if (!path) return '';
  // Only a theme that is installed has the file to serve, and only when it was
  // actually written: a stale manifest must not point at a 404.
  if (!installed || !installedPaths.includes(path)) return '';
  return `${themeAssetUrl(st.slug, path)}?v=${encodeURIComponent(st.version)}`;
}

/** Fallback card art: the theme's own three colours, laid out as a page. */
function gradientFor(st: StoreTheme): string {
  const [bg, fg, accent] = [st.preview[0] || '#f5f2ec', st.preview[1] || '#2b2b2b', st.preview[2] || '#b4552d'];
  return `linear-gradient(180deg, ${bg} 0 64%, ${fg} 64% 70%, ${bg} 70% 100%), linear-gradient(90deg, ${accent} 0 28%, ${bg} 28% 100%)`;
}

/** "1.2.0" > "1.10.0"? No — compare numerically, field by field. */
function compareVersion(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * A theme that was edited in the panel differs from the store package it came
 * from. Remember the fingerprint of the store files when they were installed, so
 * an update can tell "you changed this" from "the store changed this" instead of
 * silently overwriting someone's work.
 */
const storeStampKey = (slug: string): string => `theme_store_stamp_${slug}`;

function installedFingerprint(st: StoreTheme): string {
  const payload = JSON.stringify([st.version, st.templates, st.partials ?? {}, st.css]);
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) hash = ((hash * 33) ^ payload.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/** Which files of an installed theme differ from the store package of the same slug. */
function locallyEditedFiles(st: StoreTheme, theme: StoredTheme): string[] {
  const changed: string[] = [];
  for (const [name, body] of Object.entries(st.templates)) if (theme.templates[name] !== body) changed.push(`${name}.html`);
  for (const [name, body] of Object.entries(st.partials ?? {})) if ((theme.partials ?? {})[name] !== body) changed.push(`partials/${name}.html`);
  if (theme.css.trim() !== st.css.trim()) changed.push('style.css');
  return changed;
}

const STOPWORDS = new Set(['theme', 'ams', 'the', 'and']);

/** A store name and an installed name can differ by a suffix; match them loosely. */
const storeNameKey = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !STOPWORDS.has(w)).join('-');

/** A slug that no theme has yet, derived from a name. */
function uniqueSlug(name: string, taken: Set<string>): string {
  const base = slugify(name).replace(/-+/g, '-').slice(0, 32) || 'theme';
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Whether the theme installed under `slug` was edited in the panel since it was
 * installed from the store, and which files changed. Two signals, both cheap:
 * the name matches a store theme (which also catches a theme saved as a copy),
 * and the package fingerprint recorded at install time no longer matches the
 * installed files.
 */
function storeConflict(c: { env: Parameters<typeof getSettings>[0]; settings: Settings }, slug: string, theme: StoredTheme): { store: StoreTheme; files: string[] } | null {
  const match = storeThemes.find((st) => st.slug === slug)
    ?? storeThemes.find((st) => storeNameKey(st.name) === storeNameKey(theme.name));
  if (!match) return null;
  const files = locallyEditedFiles(match, theme);
  const stamp = c.settings[storeStampKey(slug)] ?? '';
  const storeChanged = stamp !== '' && stamp !== installedFingerprint(match);
  if (!files.length && !storeChanged) return null;
  return { store: match, files };
}

const fmtSize = (n: number): string => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

type RawThemeRow = { id: number; slug: string; name: string; version: string; active: number; manifest: string; created_at: string };

/** What the list needs: one query, tolerant of a database without the v2 columns. */
async function installedRows(c: Ctx): Promise<RawThemeRow[]> {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, slug, name, version, active, manifest, created_at FROM themes ORDER BY active DESC, name',
    ).all<RawThemeRow>();
    return results;
  } catch {
    const { results } = await c.env.DB.prepare(
      "SELECT id, slug, name, version, active, '{}' AS manifest, created_at FROM themes ORDER BY active DESC, name",
    ).all<RawThemeRow>();
    return results;
  }
}

const manifestOf = (row: { manifest: string }): Partial<ThemeManifest> => {
  try {
    return JSON.parse(row.manifest || '{}') as Partial<ThemeManifest>;
  } catch {
    return {};
  }
};

/* ------------------------------------------------------------------- list */

themes.get('/themes', async (c) => {
  const base = c.var.base;
  const rows = await installedRows(c);
  const [counts, versions, assetPaths, v2] = await Promise.all([
    Promise.all(rows.map((t) => assetCount(c.env, t.slug))),
    Promise.all(rows.map((t) => listThemeVersions(c.env, t.slug))),
    Promise.all(rows.map(async (t) => (await listThemeAssets(c.env, t.slug)).map((a) => a.path))),
    hasTable(c.env, 'theme_archives').then(() => true),
  ]);
  const installedSlugs = new Set(rows.map((t) => t.slug));
  const assetsBySlug = new Map(rows.map((t, i) => [t.slug, assetPaths[i]]));
  const settings = await getSettings(c.env);
  // Which installed themes the store also ships and which files were edited.
  const loadedThemes = await Promise.all(rows.map((t) => loadTheme(c.env, { slug: t.slug })));
  const conflictFiles = new Map<string, string[]>();
  rows.forEach((t, i) => {
    const theme = loadedThemes[i];
    if (!theme) return;
    const conflict = storeConflict({ env: c.env, settings }, t.slug, theme);
    if (conflict) conflictFiles.set(t.slug, conflict.files);
  });
  const failure = rows.map((t) => ({ slug: t.slug, fail: themeFailureFor(t.slug) })).find((x) => x.fail);

  return layout(c, 'Themes', html`
<h1>Themes</h1>
${failure ? notice(html`<b>${failure.slug}</b> failed to render, so the site is falling back to AMS Nova. Check its templates in <a href="${base}/themes/${encodeURIComponent(failure.slug)}/edit">Edit</a> — the message was “${failure.fail!.message}”.`, { tone: 'danger', title: 'Theme failed' }) : ''}
${v2 ? '' : ''}
${rows.some((t) => t.active)
  ? ''
  : notice(html`No theme is active, so pages use the bundled AMS Nova theme. <a href="${base}/themes/store/nova/install?activate=1">Activate AMS Nova</a>`, { tone: 'warn' })}

<h2>Theme store</h2>
<div class="store">
  ${storeThemes.map((st) => {
    const have = rows.find((t) => t.slug === st.slug);
    const update = Boolean(have) && compareVersion(st.version, have!.version) > 0;
    // The click-through carries the choice, and the prompt says which files would
    // be replaced — no silent overwrite of panel edits.
    const edited = have ? conflictFiles.get(st.slug) ?? [] : [];
    const changelog = (st.manifest.changelog ?? []).slice(0, 1)[0];
    // A real screenshot when the package ships one; otherwise one generated from
    // the theme's own palette, so a card is never an empty grey box.
    const shot = storeScreenshot(st, assetsBySlug.get(st.slug) ?? [], installedSlugs.has(st.slug));
    return html`<div class="card store-item" data-store-theme="${st.slug}">
      <div class="swatch" style="background:linear-gradient(135deg,${st.preview[1] || '#888'} 0 50%,${st.preview[2] || '#555'} 50% 100%);border-top:1.6rem solid ${st.preview[0] || '#fff'}" aria-hidden="true"></div>
      <div class="store-item__shot" style="${shot ? `background-image:url(${shot})` : `background:${gradientFor(st)}`}" aria-hidden="true"></div>
      <h3>${st.name} <small class="muted">v${st.version}</small></h3>
      <p class="muted">${st.description || 'No description.'}${st.manifest.author ? html` <span class="muted">· by ${st.manifest.author}</span>` : ''}</p>
      ${st.manifest.tags.length ? html`<p class="tags">${st.manifest.tags.map((t) => html`<span class="tag">${t}</span>`)}</p>` : ''}
      ${update ? html`<div class="notice notice--info store-item__update" data-update="${st.slug}">
        <p><b>Update available v${have!.version} → v${st.version}</b>${changelog && changelog.version === st.version && changelog.notes ? html` — ${changelog.notes}` : ''}</p>
        ${edited.length ? html`<p class="hint">You edited ${edited.join(', ')} in the panel. Choose what happens to those edits:</p>
        <div class="row">
          <form method="post" action="${base}/themes/store/${st.slug}/install" class="inline">${csrfField(c)}<input type="hidden" name="conflict" value="keep"><button class="btn ghost small" type="submit">Keep my changes</button></form>
          <form method="post" action="${base}/themes/store/${st.slug}/install" class="inline">${csrfField(c)}<input type="hidden" name="conflict" value="replace"><button class="btn ghost small" type="submit">Replace with v${st.version}</button></form>
          <form method="post" action="${base}/themes/store/${st.slug}/install" class="inline">${csrfField(c)}<input type="hidden" name="conflict" value="copy"><button class="btn small" type="submit">Save mine as a copy</button></form>
        </div>` : ''}
      </div>` : ''}
      <div class="row">
        ${have?.active && !update ? html`<span class="badge published">Active</span>` : ''}
        ${have && !have.active && !update ? html`<span class="badge draft">Installed</span>` : ''}
        ${!have || update ? html`<form method="post" action="${base}/themes/store/${st.slug}/install" class="inline">${csrfField(c)}<button class="btn ghost small" type="submit">${update ? `Update ${have!.version} → ${st.version}` : 'Install'}</button></form>` : ''}
        ${have?.active ? '' : html`<form method="post" action="${base}/themes/store/${st.slug}/install" class="inline">${csrfField(c)}<input type="hidden" name="activate" value="1"><button class="btn small" type="submit">${have ? 'Activate' : 'Install and activate'}</button></form>`}
        <a class="btn ghost small" href="${base}/themes/preview/${st.slug}?from=${encodeURIComponent('/themes')}">Preview</a>
      </div>
    </div>`;
  })}
</div>

<h2 style="margin-top:1.4rem">Installed themes</h2>
<div class="card">
  <ul class="list">
    ${rows.length ? rows.map((t, i) => {
      const m = manifestOf(t);
      return html`<li style="flex-wrap:wrap" data-theme-id="${t.id}" data-theme-slug="${t.slug}">
        <div class="t">
          <a href="${base}/themes/${encodeURIComponent(t.slug)}">${t.name}</a>
          <small>v${t.version}${m.author ? ` · ${m.author}` : ''}${m.parent ? html` · inherits ${m.parent}` : ''} · ${counts[i]} asset${counts[i] === 1 ? '' : 's'}${versions[i].length ? ` · ${versions[i].length} snapshot${versions[i].length === 1 ? '' : 's'}` : ''}</small>
        </div>
        ${t.active ? html`<span class="badge published">Active</span>` : html`
          <form method="post" action="${base}/themes/${t.id}/activate" class="inline">${csrfField(c)}<button class="btn small" type="submit">Activate</button></form>
          <form method="post" action="${base}/themes/${t.id}/delete" class="inline" data-confirm="Delete the theme &quot;${t.name}&quot;? Its files and settings go too.">${csrfField(c)}<button class="btn danger small" type="submit">Delete</button></form>`}
        <a class="btn ghost small" href="${base}/themes/${encodeURIComponent(t.slug)}">Manage</a>
        <a class="btn ghost small" href="${base}/themes/${t.id}/download">Download</a>
      </li>`;
    }) : html`<li><div class="t"><strong>No uploaded themes</strong><small>Install one from the store, or upload your own below.</small></div></li>`}
  </ul>
</div>

<form method="post" action="${base}/themes/upload" enctype="multipart/form-data" class="card">
  ${csrfField(c)}
  <h2>Upload a theme</h2>
  <label for="theme" style="margin-top:0">Theme file (.zip with theme.json, or a single .json)</label>
  <input type="file" id="theme" name="theme" accept=".json,.zip,application/json,application/zip" required>
  <p class="hint">Up to ${String(Math.round(MAX_THEME_UPLOAD / 1048576))} MB. A zip may carry <code>theme.json</code>, <code>*.html</code> templates, <code>partials/*.html</code>, <code>style.css</code> and <code>assets/</code> (images, fonts, one optional <code>theme.js</code>). Uploading a theme with the same name replaces it, and the previous version is snapshotted first.</p>
  <p style="margin:.8rem 0 0"><button class="btn" type="submit">Upload theme</button></p>
</form>

${card({
  title: 'Ready-made themes',
  body: html`<p class="muted">One theme ships with the app: <b>AMS Nova</b>, and it is the default. AMS Nova is a full-colour sidebar-navigation theme with dark and light options, a hero header, clean cards, a proper footer, and labelled, AdSense-ready ad slots on posts. It renders every page, sub-page and post from the same shell, and its colour scheme is changeable from its four colour settings (sidebar, accent, hero, footer) or from Appearance &rarr; Brand.</p>`,
})}

<div class="card">
  <h2>Make your own</h2>
  <p>Build a theme from a <code>theme.json</code> plus its files, or upload a ZIP. A theme is a manifest, templates, partials, a stylesheet and optional assets.</p>
  <p><a class="btn ghost" href="${base}/themes/validate">Validate a package</a></p>
  <p>Legacy JSON packages remain supported. A theme is a <code>theme.json</code> plus its files:</p>
  <pre class="pre">{
  "name": "Journal",
  "version": "1.0.0",
  "author": "You",
  "description": "Single column, serif, generous whitespace.",
  "layout": "base",
  "templates": { "base": "base.html", "post": "post.html" },
  "partials": { "header": "partials/header.html" },
  "css": "style.css",
  "assets": ["assets/logo.png"],
  "settings": [
    { "key": "accent", "type": "color", "label": "Accent", "default": "#b4552d" }
  ]
}</pre>
  <p class="hint">Only <b>base</b> is required (or a <b>parent</b> to inherit from). In a template: <code>{{post.title}}</code>, <code>{{{post.content}}}</code>, <code>{{#if post.comments_count gt 0}}</code>, <code>{{#each posts limit=3}}</code>, <code>{{> header}}</code>, <code>{{post.date | date "d MMM yyyy"}}</code>, <code>{{asset "logo.png"}}</code>, <code>{{{theme_css_url}}}</code>. Every new theme can be checked with <a href="${base}/themes/validate">Validate a theme</a> before it goes live.</p>
</div>
${raw(`<script>document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm(f.getAttribute('data-confirm')))e.preventDefault()})});</script>`)}`, '/themes');
});

/* ------------------------------------------------------------- activation */

/** Activation snapshots the theme first, so "Revert" always has something to go back to. */
async function activate(c: Ctx, where: 'id' | 'slug', value: string | number, note = 'Before activation'): Promise<void> {
  const theme = await loadTheme(c.env, where === 'id' ? { id: Number(value) } : { slug: String(value) });
  if (theme) await recordThemeVersion(c.env, theme, { note, authorId: c.var.user.id });
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE themes SET active=0 WHERE NOT ${where}=?`).bind(value),
    c.env.DB.prepare(`UPDATE themes SET active=1 WHERE ${where}=?`).bind(value),
  ]);
  await bumpCache(c.env, c.var.cfg);
}

themes.post('/themes/store/:slug/install', async (c) => {
  const stored = storeThemes.find((t) => t.slug === c.req.param('slug'));
  if (!stored) return errorPage(c, 404, 'That theme is not in the store.');
  const existing = await loadTheme(c.env, { slug: stored.slug });
  const settings = await getSettings(c.env);
  const conflict = existing ? storeConflict({ env: c.env, settings }, stored.slug, existing) : null;
  const choice = String(c.var.form.get('conflict') ?? '');

  // Three answers to "the store has a newer package and you have edited your copy".
  if (conflict && conflict.files.length) {
    if (choice === 'keep') {
      // Record that the store moved on, so the card stops nagging, but leave the
      // installed files alone.
      await setSettings(c.env, { ...settings, [storeStampKey(stored.slug)]: installedFingerprint(stored) });
      return go(c, '/themes', { ok: `Kept your edits to ${stored.slug}. v${stored.version} is available whenever you want it — the store copy is untouched.` });
    }
    if (choice === 'copy') {
      // Freeze the edited theme under a name of its own, then take the store's.
      const copyName = `${existing!.name} (mine)`.slice(0, 60);
      const { results: usedSlugs } = await c.env.DB.prepare('SELECT slug FROM themes').all<{ slug: string }>();
      const copySlug = uniqueSlug(copyName, new Set(usedSlugs.map((r) => r.slug)));
      const copyManifest = {
        ...existing!.manifest, name: copyName, slug: copySlug, version: existing!.version,
        changelog: [{ version: existing!.version, notes: `Copy of ${stored.name} made in the panel.` }],
      };
      await saveTheme(c.env, {
        manifest: copyManifest, templates: existing!.templates, partials: existing!.partials ?? {},
        css: existing!.css, assets: [], skipped: [],
      });
      await audit(c, 'installed', 'theme', `Saved your edits to “${existing!.name}” as “${copyName}”`, copySlug);
    }
    // `replace`, or a request with no choice, falls through: the snapshot below is
    // what makes it reversible.
  }
  if (existing) await recordThemeVersion(c.env, existing, { note: conflict?.files.length ? `Before store update (replaced ${conflict.files.join(', ')})` : 'Before store update', authorId: c.var.user.id });
  try {
    await saveTheme(c.env, { ...stored, assets: [], skipped: [] });
  } catch (err) {
    if (err instanceof ThemeError) return go(c, '/themes', { err: err.message });
    throw err;
  }
  // A store theme's stylesheet ships with the app, not as an uploaded asset.
  // Remember what the store package looked like when it landed, so a later edit
  // can be told apart from the store moving on.
  await setSettings(c.env, { ...settings, [storeStampKey(stored.slug)]: installedFingerprint(stored) });
  await putThemeAsset(c.env, stored.slug, 'style.css', new TextEncoder().encode(stored.css).buffer as ArrayBuffer, 'text/css; charset=utf-8');
  await indexAsset(c.env, stored.slug, { path: 'style.css', mime: 'text/css; charset=utf-8', data: new TextEncoder().encode(stored.css) });
  // Files the manifest cannot describe (the screenshot) are written here, so an
  // installed store theme matches what a zip upload of the same theme would be.
  for (const file of stored.packageFiles ?? []) {
    const clean = cleanAssetPath(file.path);
    if (!clean) continue;
    await putThemeAsset(c.env, stored.slug, clean, file.data.slice().buffer as ArrayBuffer, file.mime);
    await indexAsset(c.env, stored.slug, { path: clean, mime: file.mime, data: file.data });
  }
  if (c.var.form.get('activate') === '1' || c.req.query('activate') === '1') {
    await activate(c, 'slug', stored.slug, 'Before store install');
    await audit(c, existing ? 'updated' : 'installed', 'theme', `${existing ? 'Reinstalled' : 'Installed'} theme “${stored.name}” v${stored.version}`, stored.slug);
    await audit(c, 'activated', 'theme', `Activated theme “${stored.name}”`, stored.slug);
    return go(c, '/themes', { ok: `${stored.name} is now your active theme.` });
  }
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/themes', { ok: `${stored.name} v${stored.version} installed.` });
});

themes.post('/themes/:id{[0-9]+}/activate', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await c.env.DB.prepare('SELECT 1 AS x FROM themes WHERE id=?').bind(id).first())) return errorPage(c, 404, 'Theme not found.');
  await activate(c, 'id', id);
  const row = await c.env.DB.prepare('SELECT slug, name FROM themes WHERE id=?').bind(id).first<{ slug: string; name: string }>();
  await audit(c, 'activated', 'theme', `Activated theme “${row?.name ?? id}”`, row?.slug ?? id);
  return go(c, '/themes', { ok: 'Theme activated. The previous version is saved under its history, so you can revert.' });
});

themes.post('/themes/:id{[0-9]+}/delete', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT slug, active FROM themes WHERE id=?').bind(id).first<{ slug: string; active: number }>();
  if (!row) return errorPage(c, 404, 'Theme not found.');
  if (row.active) return go(c, '/themes', { err: 'Activate another theme before deleting this one.' });
  const children = await c.env.DB.prepare('SELECT slug FROM themes WHERE parent=?').bind(row.slug).all<{ slug: string }>();
  if (children.results.length) {
    return go(c, '/themes', { err: `${children.results.map((x) => x.slug).join(', ')} inherits from this theme. Delete or reparent those first.` });
  }
  const assets = await listThemeAssets(c.env, row.slug);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM themes WHERE id=?').bind(id),
    c.env.DB.prepare('DELETE FROM theme_assets WHERE theme_slug=?').bind(row.slug),
    c.env.DB.prepare('DELETE FROM theme_settings WHERE theme_slug=?').bind(row.slug),
  ]);
  await unindexAssets(c.env, row.slug, assets.map((a) => a.path));
  await bumpCache(c.env, c.var.cfg);
  await audit(c, 'deleted', 'theme', `Deleted theme “${row.slug}”`, row.slug);
  return go(c, '/themes', { ok: `Theme “${row.slug}” deleted.` });
});

/* ---------------------------------------------------------------- upload */

themes.post('/themes/upload', async (c) => {
  const file = c.var.form.get('theme');
  if (!file || typeof file === 'string' || !file.size) return go(c, '/themes', { err: 'Choose a theme file.' });
  if (file.size > MAX_THEME_UPLOAD) return go(c, '/themes', { err: `The file is too large (limit ${Math.round(MAX_THEME_UPLOAD / 1048576)} MB).` });
  try {
    const upload = await readUpload(await file.arrayBuffer());
    const existing = await loadTheme(c.env, { slug: upload.manifest.slug });
    const previous = await listThemeAssets(c.env, upload.manifest.slug);
    if (existing) await recordThemeVersion(c.env, existing, { note: `Before uploading v${upload.manifest.version}`, authorId: c.var.user.id });
    const result = await saveTheme(c.env, upload, previous.map((a) => a.path));
    await bumpCache(c.env, c.var.cfg);
    await audit(c, existing ? 'updated' : 'installed', 'theme',
      `${existing ? 'Updated' : 'Installed'} theme “${result.name}” v${result.version}`, result.slug);
    const parts = [`Theme “${result.name}” v${result.version} ${result.created ? 'installed' : 'updated'}`];
    if (result.assets) parts.push(`${result.assets} asset${result.assets === 1 ? '' : 's'}`);
    if (result.skipped.length) parts.push(`${result.skipped.length} file${result.skipped.length === 1 ? '' : 's'} skipped`);
    await themeSettingsSeed(c.env, upload.manifest);
    const note = result.skipped.length
      ? ` ${result.skipped.length} file(s) skipped: ${result.skipped.map((s) => `${s.path} (${s.reason})`).join(', ')}.`
      : '';
    return go(c, `/themes/${encodeURIComponent(result.slug)}`, {
      ok: parts.join(' · ') + '. Activate it when you are ready — or check it first with Validate.' + note,
    });
  } catch (err) {
    if (err instanceof ThemeError) return go(c, '/themes', { err: err.message });
    throw err;
  }
});

/** Writes declared defaults the first time a theme is installed, so the panel has values to edit. */
async function themeSettingsSeed(env: Ctx['env'], manifest: ThemeManifest): Promise<void> {
  if (!(await hasTable(env, 'theme_settings'))) return;
  const defaults = settingDefaults(manifest);
  const entries = Object.entries(defaults);
  if (!entries.length) return;
  try {
    await env.DB.batch(entries.map(([key, value]) => env.DB.prepare(
      'INSERT INTO theme_settings (theme_slug, key, value) VALUES (?,?,?) ON CONFLICT(theme_slug, key) DO NOTHING',
    ).bind(manifest.slug, key, value)));
  } catch {
    /* defaults are re-derived from the manifest at render time anyway */
  }
}

/* ------------------------------------------------------------ one theme */

themes.get('/themes/new', async (c) => {
  const base = c.var.base;
  return layout(c, t('themes.new_from'), html`
<p class="crumbs"><a href="${base}/themes">Themes</a></p>
<h1>${t('themes.new_from')}</h1>
<p class="muted">A starting point with a layout, a page template and a stylesheet — then edit it in the panel or export the zip and work locally.</p>
<form method="post" action="${base}/themes/new" class="card">
  ${csrfField(c)}
  <label for="name" style="margin-top:0">Theme name</label>
  <input type="text" id="name" name="name" required maxlength="60" placeholder="Journal" value="${themeNameSuggestion(c)}">
  <label for="kind">Starting point</label>
  <select id="kind" name="kind">
    <option value="blank">Blank — layout, page and stylesheet</option>
    <option value="child">Child of the active theme — inherit everything, override one template</option>
    <option value="copy">Copy of the active theme — a starting point you edit</option>
  </select>
  ${c.env.FILES === undefined && !(await hasTable(c.env, 'theme_assets')) ? notice('This database cannot store theme assets yet. Run updates first.', { tone: 'warn' }) : ''}
  <p style="margin:1rem 0 0"><button class="btn" type="submit">Create theme</button></p>
</form>`, '/themes');
});

/** A name that is not taken, so the form can be submitted as-is. */
function themeNameSuggestion(c: Ctx): string {
  void c;
  const taken = new Set(storeThemes.map((s) => s.slug));
  for (let i = 1; i < 40; i++) {
    const name = i === 1 ? 'My theme' : `My theme ${i}`;
    if (!taken.has(slugify(name))) return name;
  }
  return 'My theme';
}

/** Words that are pages of their own under /themes, never theme slugs. */
const RESERVED_THEME_SLUGS = ['validate', 'new', 'preview', 'upload', 'store'];

themes.get('/themes/:slug{[a-z0-9-]+}', async (c) => {
  // `/themes/new` and `/themes/validate` are their own screens; a route pattern
  // cannot know that, so the check is here rather than duplicating the ordering
  // rules of the router.
  if (RESERVED_THEME_SLUGS.includes(c.req.param('slug'))) return errorPage(c, 404, 'That admin page does not exist.');
  const slug = c.req.param('slug');
  const theme = await loadTheme(c.env, { slug });
  if (!theme) return errorPage(c, 404, 'Theme not found.');
  const base = c.var.base;
  const [assets, versions, saved] = await Promise.all([
    listThemeAssets(c.env, slug), listThemeVersions(c.env, slug), savedSettings(c, slug),
  ]);
  const values = resolveSettings(theme.manifest, saved);
  const parent = theme.manifest.parent ? await loadTheme(c.env, { slug: theme.manifest.parent }) : null;
  const templates = Object.keys(theme.templates).sort();
  const partialNames = Object.keys(theme.partials).sort();
  const failure = themeFailureFor(slug);

  return layout(c, theme.name, html`
<p class="crumbs"><a href="${base}/themes">Themes</a></p>
<h1>${theme.name} <small class="muted">v${theme.version}</small></h1>
${theme.active ? html`<p><span class="badge published">Active theme</span> <a class="btn ghost small" href="/?preview=1&theme=${encodeURIComponent(slug)}" target="_blank" rel="noopener">Preview on your site</a> <a class="btn ghost small" href="${base}/themes/${encodeURIComponent(slug)}/edit">Edit templates</a></p>`
  : html`<p><span class="badge draft">Not active</span>
      <form method="post" action="${base}/themes/${theme.id}/activate" class="inline">${csrfField(c)}<button class="btn small" type="submit">Activate</button></form>
      <a class="btn ghost small" href="/?preview=1&theme=${encodeURIComponent(slug)}" target="_blank" rel="noopener">Preview on your site</a>
      <a class="btn ghost small" href="${base}/themes/${encodeURIComponent(slug)}/edit">Edit templates</a></p>`}
${failure ? notice(html`This theme threw while rendering, so visitors saw AMS Nova instead. ${failure.message}`, { tone: 'danger', title: 'Render failed' }) : ''}
${theme.manifest.description ? html`<p class="muted">${theme.manifest.description}</p>` : ''}
${theme.manifest.author ? html`<p class="muted">By ${theme.manifest.author}${theme.manifest.homepage ? html` · <a href="${theme.manifest.homepage}" target="_blank" rel="noopener noreferrer">homepage</a>` : ''}</p>` : ''}
${parent ? html`<p class="muted">Inherits templates, partials and assets from <a href="${base}/themes/${encodeURIComponent(parent.slug)}">${parent.name}</a>.</p>` : ''}

<div class="grid-2">
${card({
  title: 'Files',
  body: html`<dl class="kv">
    <dt>Templates</dt><dd>${templates.join(', ') || 'none uploaded'}</dd>
    <dt>Partials</dt><dd>${partialNames.length ? partialNames.join(', ') : 'none'}</dd>
    <dt>Stylesheet</dt><dd>${theme.css ? `${fmtSize(theme.css.length)} inline, served as an asset` : 'inherited or none'}</dd>
    <dt>Assets</dt><dd>${assets.length ? assets.map((a) => html`<div><code>${a.path}</code> <small class="muted">${fmtSize(a.size)}</small></div>`) : 'none'}</dd>
    <dt>Layout</dt><dd><code>{{#block content}}</code> in <code>${theme.manifest.layout || 'base'}</code></dd>
  </dl>`,
})}
${card({
  title: 'History',
  head: html`<span class="muted">Snapshots are written before every activation or upload.</span>`,
  body: versions.length ? html`<ul class="list">
    ${versions.map((v) => html`<li>
      <div class="t"><strong>${v.note || 'Snapshot'}</strong><small>v${v.version} · ${v.created_at.slice(0, 16).replace('T', ' ')}${v.author ? ` · ${v.author}` : ''}</small></div>
      <form method="post" action="${base}/themes/${encodeURIComponent(slug)}/versions/${v.id}/restore" class="inline" data-confirm="${t('themes.rollback_confirm')}">${csrfField(c)}<button class="btn ghost small" type="submit">${t('themes.rollback')}</button></form>
    </li>`)}
  </ul>` : html`<p class="muted">No snapshots yet. One is written the first time this theme is updated or activated.</p>`,
})}
</div>

${theme.manifest.settings.length ? card({
  title: 'Theme settings',
  head: html`<span class="muted">Defaults come from the theme; your changes are stored per theme.</span>`,
  body: html`<form method="post" action="${base}/themes/${encodeURIComponent(slug)}/settings">
    ${csrfField(c)}
    ${theme.manifest.settings.map((s) => settingField(s, values[s.key] ?? ''))}
    <p style="margin:1rem 0 0"><button class="btn" type="submit">Save settings</button>
    <button class="btn ghost" type="submit" formaction="${base}/themes/${encodeURIComponent(slug)}/settings/reset">Reset to defaults</button></p>
  </form>`,
}) : ''}

${card({
  title: 'Assets',
  head: html`<span class="muted">${assets.length} / ${MAX_ASSETS_PER_THEME} files</span>`,
  body: html`
  ${assets.length ? html`<ul class="list">
    ${assets.map((a) => html`<li>
      <div class="t"><a href="${themeAssetUrl(slug, a.path)}" target="_blank" rel="noopener"><code>${a.path}</code></a><small>${a.mime} · ${fmtSize(a.size)}</small></div>
      <form method="post" action="${base}/themes/${encodeURIComponent(slug)}/assets/delete" class="inline">${csrfField(c)}<input type="hidden" name="path" value="${a.path}"><button class="btn danger small" type="submit">Remove</button></form>
    </li>`)}
  </ul>` : html`<p class="muted">No assets. Upload a logo, a font or <code>theme.js</code> below — they are served from <code>/theme-assets/${slug}/…</code> with a long cache.</p>`}
  ${assetLimitReached(assets.length) ? html`<p class="muted">Asset limit reached (${MAX_ASSETS_PER_THEME} files).</p>` : html`<form method="post" action="${base}/themes/${encodeURIComponent(slug)}/assets" enctype="multipart/form-data" style="margin-top:.8rem">
    ${csrfField(c)}
    <label for="asset">Add a file</label>
    <input type="file" id="asset" name="file" required accept=".png,.jpg,.jpeg,.gif,.webp,.avif,.ico,.woff,.woff2,.ttf,.otf,.js">
    <label for="asset-path">Store as (optional)</label>
    <input type="text" id="asset-path" name="path" placeholder="logo.png or fonts/body.woff2">
    <p class="hint">PNG/JPEG/GIF/WebP/AVIF/ICO, WOFF/WOFF2/TTF/OTF fonts, or <code>theme.js</code> (load it from your layout with <code>&lt;script defer src="{{asset "theme.js"}}"&gt;</code>). Max ${fmtSize(MAX_THEME_ASSET)}. SVG and HTML are refused on purpose: they can carry script.</p>
    <button class="btn small" type="submit">Upload asset</button>
  </form>`}`,
})}

${theme.manifest.changelog.length ? card({
  title: 'Changelog',
  body: html`<ul class="list">${theme.manifest.changelog.map((e) => html`<li><div class="t"><strong>v${e.version}</strong><small>${e.notes}</small></div></li>`)}</ul>`,
}) : ''}

<div class="row" style="margin-top:1rem">
  <a class="btn ghost" href="${base}/themes/${encodeURIComponent(slug)}/validate">Validate this theme</a>
  <a class="btn ghost" href="${base}/themes/${encodeURIComponent(slug)}/edit">${t('themes.editor')}</a>
  <a class="btn ghost" href="${base}/themes/${theme.id}/download">${t('themes.export')}</a>
  <a class="btn ghost" href="${base}/themes/${theme.id}/download.json">theme.json</a>
  <a class="btn ghost" href="${base}/themes/new">${t('themes.new_from')}</a>
  ${theme.active ? '' : html`<form method="post" action="${base}/themes/${theme.id}/delete" class="inline" data-confirm="Delete this theme and its files?">${csrfField(c)}<button class="btn danger" type="submit">Delete theme</button></form>`}
</div>
${raw(`<script>document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm(f.getAttribute('data-confirm')))e.preventDefault()})});</script>`)}`, '/themes');
});

function settingField(s: ThemeSetting, value: string): unknown {
  const id = `set-${s.key}`;
  const label = html`<label for="${id}">${s.label}${s.help ? html` <small class="muted">${s.help}</small>` : ''}</label>`;
  switch (s.type) {
    case 'toggle':
      return html`<label class="check" for="${id}"><input type="checkbox" id="${id}" name="${s.key}" value="1"${value === '1' ? raw(' checked') : raw('')}> ${s.label}</label>`;
    case 'textarea':
      return html`${label}<textarea id="${id}" name="${s.key}" rows="4">${value}</textarea>`;
    case 'color':
      return html`${label}<input type="color" id="${id}" name="${s.key}" value="${/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}">`;
    case 'number':
    case 'range':
      return html`${label}<input type="${s.type}" id="${id}" name="${s.key}" value="${value}"${s.min !== undefined ? raw(` min="${s.min}"`) : raw('')}${s.max !== undefined ? raw(` max="${s.max}"`) : raw('')}${s.step !== undefined ? raw(` step="${s.step}"`) : raw(' step="any"')}>`;
    case 'select':
      return html`${label}<select id="${id}" name="${s.key}">
        ${(s.options ?? []).map((o) => html`<option value="${o.value}"${o.value === value ? raw(' selected') : raw('')}>${o.label}</option>`)}
      </select>`;
    case 'image':
      return html`<div class="media-field">
        ${label}
        <input type="hidden" id="${id}" name="${s.key}" value="${value}" data-media-field>
        <div class="row">${value && /^(\/|https?:)/.test(value) ? html`<img src="${value}" alt="" style="max-height:4rem;border-radius:.4rem">` : ''}
          <button type="button" class="btn ghost small" data-open-picker="${id}">Choose image</button>
          <input type="text" value="${value}" data-media-text aria-label="Image URL"></div>
      </div>`;
    default:
      return html`${label}<input type="text" id="${id}" name="${s.key}" value="${value}"${s.type === 'url' ? raw(' inputmode="url"') : raw('')}>`;
  }
}

async function savedSettings(c: Ctx, slug: string): Promise<Record<string, string> | null> {
  try {
    const { results } = await c.env.DB.prepare('SELECT key, value FROM theme_settings WHERE theme_slug=?')
      .bind(slug).all<{ key: string; value: string }>();
    const out: Record<string, string> = {};
    for (const r of results) out[r.key] = r.value;
    return out;
  } catch {
    return null;
  }
}

themes.post('/themes/:slug/settings', async (c) => {
  const slug = c.req.param('slug');
  const theme = await loadTheme(c.env, { slug });
  if (!theme) return errorPage(c, 404, 'Theme not found.');
  const saved = await saveSettingsValues(c, theme.manifest, c.var.form);
  clearThemeValueCache(c.env);
  await bumpCache(c.env, c.var.cfg);
  return go(c, `/themes/${encodeURIComponent(slug)}`, { ok: `Saved ${saved} setting${saved === 1 ? '' : 's'}.` });
});

themes.post('/themes/:slug/settings/reset', async (c) => {
  const slug = c.req.param('slug');
  try {
    await c.env.DB.prepare('DELETE FROM theme_settings WHERE theme_slug=?').bind(slug).run();
  } catch {
    return go(c, `/themes/${encodeURIComponent(slug)}`, { err: 'This database cannot store theme settings yet. Run updates first.' });
  }
  clearThemeValueCache(c.env);
  await bumpCache(c.env, c.var.cfg);
  return go(c, `/themes/${encodeURIComponent(slug)}`, { ok: 'Settings reset to the theme defaults.' });
});

async function saveSettingsValues(c: Ctx, manifest: ThemeManifest, form: FormData): Promise<number> {
  const rows = manifest.settings.map((s) => {
    const raw2 = form.get(s.key);
    return { key: s.key, value: validateThemeSettingValue(s, raw2) };
  });
  if (!rows.length) return 0;
  try {
    await c.env.DB.batch(rows.map((r) => c.env.DB.prepare(
      `INSERT INTO theme_settings (theme_slug, key, value) VALUES (?,?,?)
       ON CONFLICT(theme_slug, key) DO UPDATE SET value=excluded.value`,
    ).bind(manifest.slug, r.key, r.value)));
  } catch {
    throw new ThemeError('This database cannot store theme settings yet. Run updates first.');
  }
  return rows.length;
}

/* --------------------------------------------------------------- versions */

themes.post('/themes/:slug/versions/:id{[0-9]+}/restore', async (c) => {
  const slug = c.req.param('slug');
  const theme = await loadTheme(c.env, { slug });
  if (!theme) return errorPage(c, 404, 'Theme not found.');
  // Snapshot what we are about to replace, so a revert is itself revertible.
  await recordThemeVersion(c.env, theme, { note: 'Before revert', authorId: c.var.user.id });
  const ok = await restoreThemeVersion(c.env, slug, Number(c.req.param('id')));
  if (!ok) return go(c, `/themes/${encodeURIComponent(slug)}`, { err: 'That snapshot could not be restored.' });
  // The stylesheet lives in the file store as well as in the row, so a rollback
  // has to write it back or pages would keep the newer CSS.
  const restored = await loadTheme(c.env, { slug });
  if (restored?.css) {
    const bytes = new TextEncoder().encode(restored.css);
    await putThemeAsset(c.env, slug, 'style.css', bytes.buffer as ArrayBuffer, 'text/css; charset=utf-8');
    await indexAsset(c.env, slug, { path: 'style.css', mime: 'text/css; charset=utf-8', data: bytes });
  }
  await bumpCache(c.env, c.var.cfg);
  await audit(c, 'restored', 'theme', `Rolled back theme “${theme.name}”`, slug);
  return go(c, `/themes/${encodeURIComponent(slug)}`, { ok: 'Files restored from the snapshot. Upload the matching assets if that version had different ones.' });
});

/* ----------------------------------------------------------------- assets */

themes.post('/themes/:slug/assets', async (c) => {
  const slug = c.req.param('slug');
  const theme = await loadTheme(c.env, { slug });
  if (!theme) return errorPage(c, 404, 'Theme not found.');
  const file = c.var.form.get('file');
  if (!file || typeof file === 'string' || !file.size) return go(c, `/themes/${encodeURIComponent(slug)}`, { err: 'Choose a file first.' });
  const requested = String(c.var.form.get('path') ?? '').trim() || file.name;
  const path = cleanAssetPath(requested);
  if (!path) return go(c, `/themes/${encodeURIComponent(slug)}`, { err: 'That file name is not allowed. Use letters, digits, dots and dashes.' });
  if (isRefusedAsset(path)) return go(c, `/themes/${encodeURIComponent(slug)}`, { err: `${path.split('.').pop()!.toUpperCase()} files are refused: they can carry script.` });
  const mime = assetMime(path);
  if (!mime) return go(c, `/themes/${encodeURIComponent(slug)}`, { err: 'That file type is not allowed in a theme.' });
  if (file.size > MAX_THEME_ASSET) return go(c, `/themes/${encodeURIComponent(slug)}`, { err: `The file is too large (limit ${fmtSize(MAX_THEME_ASSET)}).` });
  const count = await assetCount(c.env, slug);
  if (assetLimitReached(count)) return go(c, `/themes/${encodeURIComponent(slug)}`, { err: `This theme already has ${MAX_ASSETS_PER_THEME} assets.` });
  const data = await file.arrayBuffer();
  await putThemeAsset(c.env, slug, path, data, mime);
  await indexAsset(c.env, slug, { path, mime, data: new Uint8Array(data) } as UploadedAsset);
  // Keep the manifest's asset list truthful, so {{asset}} validation stays useful.
  const manifest = { ...theme.manifest, assets: [...new Set([...theme.manifest.assets, path])] };
  try {
    await c.env.DB.prepare('UPDATE themes SET manifest=? WHERE slug=?').bind(JSON.stringify(manifest), slug).run();
  } catch {
    /* the file is what matters */
  }
  await bumpCache(c.env, c.var.cfg);
  return go(c, `/themes/${encodeURIComponent(slug)}`, { ok: `Uploaded ${path}. Use it with {{asset "${path}"}}.` });
});

themes.post('/themes/:slug/assets/delete', async (c) => {
  const slug = c.req.param('slug');
  const path = cleanAssetPath(String(c.var.form.get('path') ?? ''));
  if (!path) return go(c, `/themes/${encodeURIComponent(slug)}`, { err: 'Which file?' });
  await unindexAssets(c.env, slug, [path]);
  try {
    const { deleteFile } = await import('../../lib/files');
    await deleteFile(c.env, `themes/${slug}/${path}`);
  } catch {
    /* already gone */
  }
  await bumpCache(c.env, c.var.cfg);
  return go(c, `/themes/${encodeURIComponent(slug)}`, { ok: `Removed ${path}.` });
});

/* -------------------------------------------------------------- validate */

/** Validates a theme file without installing it: the step before "Activate". */
themes.get('/themes/validate', async (c) => {
  const base = c.var.base;
  return layout(c, 'Validate a theme', html`
<p class="crumbs"><a href="${base}/themes">Themes</a></p>
<h1>Validate a theme</h1>
<p class="muted">Checks a <code>.zip</code> or <code>.json</code> theme without installing anything: template syntax, unknown filters, missing partials, assets the manifest names but does not ship, and settings.</p>
<form method="post" action="${base}/themes/validate" enctype="multipart/form-data" class="card">
  ${csrfField(c)}
  <label for="theme" style="margin-top:0">Theme file</label>
  <input type="file" id="theme" name="theme" accept=".json,.zip" required>
  <p style="margin:.8rem 0 0"><button class="btn" type="submit">Validate</button></p>
</form>`, '/themes');
});

themes.post('/themes/validate', async (c) => {
  const file = c.var.form.get('theme');
  if (!file || typeof file === 'string' || !file.size) return go(c, '/themes/validate', { err: 'Choose a theme file.' });
  return renderReport(c, await file.arrayBuffer());
});

themes.get('/themes/:slug/validate', async (c) => {
  const slug = c.req.param('slug');
  const theme = await loadTheme(c.env, { slug });
  if (!theme) return errorPage(c, 404, 'Theme not found.');
  return renderReport(c, null, theme.slug);
});

type Problem = { where: string; message: string; level: 'err' | 'warn' };

/** The shared report for both "check this file" and "check this installed theme". */
async function renderReport(c: Ctx, buf: ArrayBuffer | null, installedSlug?: string): Promise<Response> {
  const base = c.var.base;
  let manifest: ThemeManifest | null = null;
  let templates: Record<string, string> = {};
  let partials: Record<string, string> = {};
  let assets: string[] = [];
  let css = '';
  let skipped: { path: string; reason: string }[] = [];
  const problems: Problem[] = [];

  if (buf) {
    try {
      const upload = await readUpload(buf);
      manifest = upload.manifest; templates = upload.templates; partials = upload.partials;
      assets = upload.assets.map((a) => a.path); css = upload.css; skipped = upload.skipped;
    } catch (err) {
      problems.push({ where: 'theme.json', message: err instanceof Error ? err.message : String(err), level: 'err' });
    }
  } else if (installedSlug) {
    const theme = await loadTheme(c.env, { slug: installedSlug });
    if (theme) {
      manifest = theme.manifest; templates = theme.templates; partials = theme.partials; css = theme.css;
      assets = (await listThemeAssets(c.env, installedSlug)).map((a) => a.path);
    }
  }

  if (manifest) {
    // 1. Syntax and filters in every template and partial.
    for (const [name, source] of Object.entries(templates)) {
      const report = inspectTemplate(source);
      for (const p of report.problems) problems.push({ where: `${name} template`, message: p, level: 'err' });
      for (const use of report.partials) {
        const clean = use.replace(/^@theme\s+/, '');
        if (clean.startsWith('@theme')) continue;
        if (!(clean in partials) && !(manifest.parent && !use.startsWith('@theme'))) {
          problems.push({ where: `${name} template`, message: `uses the partial “${clean}”, which this theme does not have`, level: 'warn' });
        }
      }
    }
    for (const [name, source] of Object.entries(partials)) {
      for (const p of inspectTemplate(source).problems) problems.push({ where: `partial ${name}`, message: p, level: 'err' });
    }
    // 2. Values the theme leans on that the renderer must supply.
    const known = new Set(['site', 'menu', 'pages', 'year', 'body_class', 'comments', 'comments_count', 'comments_open',
      'comments_html', 'post', 'page', 'posts', 'archive', 'pagination', 'theme', 'content', 'head', 'footer',
      'theme_css', 'theme_css_url', 'nonce', 'is_home', 'comment_notice', 'reply_to', 'block', 'tz', 'this', 'value']);
    // Helper calls (`{{asset "x"}}`) are functions, not values: the first word is
    // the helper name, so it must not be reported as a missing value.
    const helpers = new Set(['asset', 'url', 'default', 'truncate', 'date', 'slug', 'escape', 'json', 'nl2br']);
    const used = new Set<string>();
    const scan = (source: string): void => {
      for (const m of source.matchAll(/\{\{\{?\s*([\w.]+)(\s)/g)) {
        const first = m[1].split('.')[0];
        if (helpers.has(first)) continue;
        used.add(first);
      }
    };
    for (const source of [...Object.values(templates), ...Object.values(partials)]) scan(source);
    for (const name of used) {
      if (!known.has(name) && !(manifest.settings ?? []).some((s) => s.key === name)) {
        problems.push({ where: 'templates', message: `“${name}” is not one of the values the CMS provides; it renders empty`, level: 'warn' });
      }
    }
    // 3. Assets the manifest promises.
    for (const path of manifest.assets) {
      if (!assets.includes(path)) problems.push({ where: 'assets', message: `the manifest lists “${path}” but the theme does not ship it`, level: 'err' });
    }
    for (const path of assets) {
      if (isRefusedAsset(path)) problems.push({ where: 'assets', message: `“${path}” is a refused file type`, level: 'err' });
    }
    // 4. Inheritance.
    if (manifest.parent) {
      const parent = await loadTheme(c.env, { slug: manifest.parent });
      if (!parent) problems.push({ where: 'theme.json', message: `parent theme “${manifest.parent}” is not installed`, level: 'err' });
      else if (manifest.parent === manifest.slug) problems.push({ where: 'theme.json', message: 'a theme cannot inherit from itself', level: 'err' });
    }
    for (const skip of skipped) problems.push({ where: 'assets', message: `${skip.path}: ${skip.reason}`, level: 'warn' });
    if (!css && !assets.includes('style.css') && !manifest.parent) {
      problems.push({ where: 'style.css', message: 'this theme ships no stylesheet', level: 'warn' });
    }
    if (!/\{\{\{?\s*(content|body)\s*\}?\}\}|\{\{#block\s+content\}\}/.test(templates[manifest.layout] ?? templates.base ?? '')) {
      problems.push({ where: 'base template', message: 'the layout has no {{#block content}} (or {{{content}}}) — the page body has nowhere to go', level: 'err' });
    }
  }

  const errors = problems.filter((p) => p.level === 'err');
  const warnings = problems.filter((p) => p.level === 'warn');
  return layout(c, 'Theme report', html`
<p class="crumbs"><a href="${base}/themes">Themes</a></p>
<h1>Theme report${manifest ? html` — ${manifest.name} v${manifest.version}` : ''}</h1>
${problems.length === 0 ? notice('No problems found: this theme is ready to install or activate.', { tone: 'info', title: 'All good' })
  : html`<p>${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.</p>`}
${problems.length ? card({
  title: 'Findings',
  body: html`<ul class="list">
    ${[...errors, ...warnings].map((p) => html`<li><div class="t">
      <strong>${p.where}</strong>
      <small>${p.level === 'err' ? 'Error · ' : 'Warning · '}${p.message}</small>
    </div><span class="badge ${p.level === 'err' ? 'danger' : 'draft'}">${p.level === 'err' ? 'Error' : 'Warning'}</span></li>`)}
  </ul>`,
}) : ''}
${manifest ? card({
  title: 'What this theme declares',
  body: html`<dl class="kv">
    <dt>Name</dt><dd>${manifest.name} (${manifest.slug})</dd>
    <dt>Version</dt><dd>${manifest.version}</dd>
    <dt>Templates</dt><dd>${Object.keys(templates).join(', ') || 'none'}</dd>
    <dt>Partials</dt><dd>${Object.keys(partials).join(', ') || 'none'}</dd>
    <dt>Layout</dt><dd>${manifest.layout}</dd>
    <dt>Parent</dt><dd>${manifest.parent ?? 'none'}</dd>
    <dt>Assets</dt><dd>${assets.join(', ') || 'none'}</dd>
    <dt>Settings</dt><dd>${manifest.settings.length ? manifest.settings.map((s) => `${s.label} (${s.type})`).join(', ') : 'none'}</dd>
    <dt>Stylesheet</dt><dd>${css ? `${fmtSize(css.length)} inline` : 'none'}</dd>
  </dl>`,
}) : ''}
<p><a class="btn ghost" href="${base}/themes">Back to themes</a>${installedSlug ? html` <a class="btn" href="${base}/themes/validate">Validate another file</a>` : html` <a class="btn" href="${base}/themes">Install it from Themes</a>`}</p>`, '/themes');
}

/* ---------------------------------------------------------------- editor */

/**
 * Editing a theme inside the panel.
 *
 * A theme is text — templates, partials, one stylesheet — so the editor is a
 * plain `<textarea>` per file: no CodeMirror, no build step, no dependency, and
 * it works with the keyboard and without JavaScript. Every save runs the same
 * validator an upload does (`parseManifest` + `inspectTemplate`), so an edit
 * cannot install something an upload would have refused. A save is snapshotted
 * first, which is what makes "Roll back" meaningful for edits as well.
 */
type EditableFile = { path: string; kind: 'template' | 'partial' | 'css'; body: string };

function editableFiles(theme: StoredTheme): EditableFile[] {
  const out: EditableFile[] = [];
  for (const [name, body] of Object.entries(theme.templates)) out.push({ path: `${name}.html`, kind: 'template', body });
  for (const [name, body] of Object.entries(theme.partials)) out.push({ path: `partials/${name}.html`, kind: 'partial', body });
  if (theme.css) out.push({ path: 'style.css', kind: 'css', body: theme.css });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** `templates/page.html` / `page.html` / `style.css` → which file the form means. */
function parseFilePath(file: string): { kind: 'template' | 'partial' | 'css'; name: string } | null {
  if (file === 'style.css') return { kind: 'css', name: 'style' };
  const m = file.match(/^(?:templates\/)?([a-z0-9-]{1,30})\.html$/);
  if (m) return { kind: 'template', name: m[1] };
  const p = file.match(/^partials\/([a-z0-9-]{1,30})\.html$/);
  if (p) return { kind: 'partial', name: p[1] };
  return null;
}

themes.get('/themes/:slug/edit', async (c) => {
  const slug = c.req.param('slug');
  const theme = await loadTheme(c.env, { slug });
  if (!theme) return errorPage(c, 404, 'Theme not found.');
  const base = c.var.base;
  const files = editableFiles(theme);
  const wanted = String(c.req.query('file') || (files[0]?.path ?? ''));
  const current = files.find((f) => f.path === wanted) ?? files[0];
  const report = current ? inspectTemplate(current.body) : { problems: [] as string[], partials: [] as string[] };

  return layout(c, `Edit ${theme.name}`, html`
<p class="crumbs"><a href="${base}/themes">Themes</a> / <a href="${base}/themes/${encodeURIComponent(slug)}">${theme.name}</a></p>
<h1>${t('themes.editor')} — ${theme.name} <small class="muted">v${theme.version}</small></h1>
<p class="muted">${t('themes.editor_hint')}</p>
<div class="theme-editor">
  <nav class="theme-editor__files" aria-label="Theme files">
    <ul class="list list--rows">
      ${files.map((f) => html`<li${f.path === current?.path ? raw(' class="is-current"') : raw('')}>
        <div class="t"><a href="${base}/themes/${encodeURIComponent(slug)}/edit?file=${encodeURIComponent(f.path)}">${f.path}</a>
          <small>${f.kind}${f.kind === 'css' ? '' : ` · ${f.body.split('\n').length} lines`}</small></div>
      </li>`)}
    </ul>
    <p class="hint">JSON (settings, tagline, changelog) is edited on the theme's own screen. Assets are uploaded, not typed.</p>
  </nav>
  <div class="theme-editor__body">
    ${current ? html`<form method="post" action="${base}/themes/${encodeURIComponent(slug)}/edit">
      ${csrfField(c)}
      <input type="hidden" name="file" value="${current.path}">
      <label for="file-body">${current.path}</label>
      <textarea id="file-body" name="body" rows="24" spellcheck="false" class="pre theme-editor__code">${current.body}</textarea>
      ${report.problems.length ? notice(html`${report.problems.map((p) => html`<div>${p}</div>`)}`, { tone: 'warn', title: 'This file has problems right now' }) : ''}
      <p class="row" style="margin:1rem 0 0">
        <button class="btn" type="submit">Save ${current.path}</button>
        <a class="btn ghost" href="${base}/themes/${encodeURIComponent(slug)}/validate">Validate the theme</a>
        <a class="btn ghost" href="${base}/themes/${encodeURIComponent(slug)}">Back to ${theme.name}</a>
      </p>
    </form>` : html`<p class="muted">This theme has no editable files yet.</p>`}
  </div>
</div>`, '/themes');
});

themes.post('/themes/:slug/edit', async (c) => {
  const slug = c.req.param('slug');
  const theme = await loadTheme(c.env, { slug });
  if (!theme) return errorPage(c, 404, 'Theme not found.');
  const target = parseFilePath(String(c.var.form.get('file') ?? ''));
  if (!target) return go(c, `/themes/${encodeURIComponent(slug)}/edit`, { err: 'That is not a file a theme can have.' });
  const body = String(c.var.form.get('body') ?? '');
  if (body.length > 400 * 1024) return go(c, `/themes/${encodeURIComponent(slug)}/edit?file=${encodeURIComponent(`${target.name}.html`)}`, { err: 'That file is too large (limit 400 KB).' });

  const templates = { ...theme.templates };
  const partials = { ...theme.partials };
  let css = theme.css;
  let file = '';
  if (target.kind === 'css') {
    css = body;
    file = 'style.css';
  } else if (target.kind === 'partial') {
    partials[target.name] = body;
    file = `partials/${target.name}.html`;
  } else {
    templates[target.name] = body;
    file = `${target.name}.html`;
  }

  // Validate before storing: the same check an upload goes through, so an edit
  // can never install a theme an upload would have refused.
  const manifestInput = { ...theme.manifest, templates, partials, css } as unknown as Record<string, unknown>;
  try {
    const parsed = parseManifest(manifestInput);
    if (target.kind !== 'css') {
      const report = inspectTemplate(body);
      if (report.problems.length) {
        return go(c, `/themes/${encodeURIComponent(slug)}/edit?file=${encodeURIComponent(file)}`, { err: `${file}: ${report.problems[0]}` });
      }
    }
    await recordThemeVersion(c.env, theme, { note: `Before editing ${file}`, authorId: c.var.user.id });
    await saveTheme(c.env, {
      manifest: parsed.manifest, templates: parsed.templates, partials: parsed.partials, css: parsed.css,
      assets: [], skipped: [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return go(c, `/themes/${encodeURIComponent(slug)}/edit?file=${encodeURIComponent(file)}`, { err: message });
  }
  await bumpCache(c.env, c.var.cfg);
  await audit(c, 'updated', 'theme', `Edited ${file} in theme “${theme.name}”`, slug);
  return go(c, `/themes/${encodeURIComponent(slug)}/edit?file=${encodeURIComponent(file)}`, { ok: t('themes.saved', { file }) });
});

/**
 * New theme from a template: the panel writes the smallest theme that actually
 * renders (a layout with the content block, one page template, a stylesheet)
 * and names it. From there the editor is the whole story.
 */
const BLANK_BASE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  {{{head}}}
  <link rel="stylesheet" href="{{{theme_css_url}}}">
</head>
<body class="{{body_class}}">
  <header class="site-head">
    <a class="site-title" href="/">{{site.title}}</a>
    <nav>{{#each menu.primary}}<a href="{{url}}">{{label}}</a>{{/each}}</nav>
  </header>
  <main class="site-main">{{{content}}}</main>
  {{{widgets.footer}}}
  {{{footer}}}
</body>
</html>
`;

const BLANK_PAGE = `<article class="entry">
  <h1>{{page.title}}</h1>
  {{{page.content}}}
</article>
`;

const BLANK_CSS = `:root { --accent: #2457d6; --bg: #ffffff; --fg: #1c2330; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.6 system-ui, sans-serif; }
.site-head { display: flex; gap: 1.5rem; align-items: baseline; padding: 1.2rem 5vw; border-bottom: 1px solid color-mix(in oklab, var(--fg) 15%, transparent); }
.site-title { font-weight: 700; text-decoration: none; color: inherit; }
.site-head nav a { margin-right: 1rem; color: var(--accent); }
.site-main { padding: 2.5rem 5vw; max-width: 46rem; }
`;

themes.post('/themes/new', async (c) => {
  const name = String(c.var.form.get('name') ?? '').trim().slice(0, 60);
  const kind = ['blank', 'child', 'copy'].includes(String(c.var.form.get('kind'))) ? String(c.var.form.get('kind')) : 'blank';
  if (!name) return go(c, '/themes/new', { err: 'Give the theme a name.' });
  const base = c.var.base;
  const active = await loadTheme(c.env, { slug: '' }).catch(() => null);
  const activeTheme2 = active ?? (await c.env.DB.prepare('SELECT slug FROM themes WHERE active=1 LIMIT 1').bind().first<{ slug: string }>()
    .then((r) => (r ? loadTheme(c.env, { slug: r.slug }) : null)));
  if (kind !== 'blank' && !activeTheme2) return go(c, '/themes/new', { err: 'There is no active theme to inherit from. Create a blank theme instead.' });

  const manifest: Record<string, unknown> = kind === 'child'
    ? {
      name, slug: slugify(name), version: '1.0.0', author: '', description: `${name}, a child of ${activeTheme2!.name}.`,
      parent: activeTheme2!.slug, layout: 'base',
      templates: { page: BLANK_PAGE },
      partials: {}, settings: [], changelog: [{ version: '1.0.0', notes: 'Created in the panel.' }],
    }
    : {
      name, slug: slugify(name), version: '1.0.0', author: '', description: `${name}, made in the panel.`,
      layout: 'base',
      templates: { base: BLANK_BASE, page: BLANK_PAGE },
      partials: {}, css: BLANK_CSS,
      settings: [
        { key: 'tagline', type: 'text', label: 'Tagline', default: 'Words under the title' },
      ],
      widgets: ['footer'],
      changelog: [{ version: '1.0.0', notes: 'Created in the panel.' }],
    };

  // `copy` starts from the active theme's files rather than the blank ones.
  if (kind === 'copy' && activeTheme2) {
    manifest.templates = activeTheme2.templates;
    manifest.partials = activeTheme2.partials;
    manifest.css = activeTheme2.css;
    manifest.parent = undefined;
    delete manifest.parent;
  }

  try {
    const json = JSON.stringify(manifest);
    const upload = await readUpload(new TextEncoder().encode(json).buffer as ArrayBuffer);
    const result = await saveTheme(c.env, upload, []);
    await bumpCache(c.env, c.var.cfg);
    await audit(c, 'installed', 'theme', `Created theme “${name}” (${kind})`, result.slug);
    return go(c, `/themes/${encodeURIComponent(result.slug)}/edit`, { ok: `“${name}” created. Edit its files, then activate it when it looks right.` });
  } catch (err) {
    if (err instanceof ThemeError) return go(c, '/themes/new', { err: err.message });
    throw err;
  }
});

/* --------------------------------------------------------------- preview */

/**
 * The theme store's live preview: the real site, rendered with a theme that is
 * not (or not yet) active.
 *
 * A store theme that has never been installed has no row and no asset URL, so
 * its stylesheet is served from memory (`preview.css`). An installed theme is
 * served exactly as it would be live. Nothing here activates anything: the
 * renderer takes a bundle for this request only.
 */
const previewCache = new WeakMap<object, Map<string, StoreTheme>>();
const storeThemeFor = (slug: string): StoreTheme | undefined => storeThemes.find((t) => t.slug === slug);

themes.get('/themes/preview/:slug', async (c) => {
  const slug = c.req.param('slug');
  const base = c.var.base;
  const from = String(c.req.query('from') || '/themes').slice(0, 200);
  const fresh = String(c.req.query('version') || '').slice(0, 20);
  const store = storeThemeFor(slug);
  const installed = await loadTheme(c.env, { slug });
  const name = installed?.name ?? store?.name ?? slug;
  const version = installed?.version ?? store?.version ?? '';
  const active = installed ? (await c.env.DB.prepare('SELECT active FROM themes WHERE slug=?').bind(slug).first<{ active: number }>())?.active === 1 : false;

  // Paths the preview frame can show: the home page, the blog, a post, a page.
  const [home, post] = await Promise.all([
    c.env.DB.prepare("SELECT slug FROM content WHERE site_id=1 AND type='page' AND status='published' ORDER BY id LIMIT 1").first<{ slug: string }>().catch(() => null),
    c.env.DB.prepare("SELECT slug FROM content WHERE site_id=1 AND type='post' AND status='published' ORDER BY id DESC LIMIT 1").first<{ slug: string }>().catch(() => null),
  ]);
  const paths = ['/', '/blog', ...(post ? ['/blog/' + post.slug] : []), ...(home && home.slug !== 'home' ? ['/' + home.slug] : [])];
  const start = paths.includes(String(c.req.query('path'))) ? String(c.req.query('path')) : '/';

  return layout(c, `Preview ${name}`, html`
<p class="crumbs"><a href="${base}${from}">${from === '/themes' ? 'Themes' : 'Back'}</a></p>
<h1>${t('themes.preview')} — ${name} <small class="muted">v${version}</small></h1>
<p class="muted">${t('themes.preview_hint')}</p>
<div class="card customizer__bar">
  <div class="row">
    ${paths.map((p) => html`<a class="btn ${p === start ? '' : 'ghost'} small" href="${base}/themes/preview/${encodeURIComponent(slug)}?path=${encodeURIComponent(p)}&from=${encodeURIComponent(from)}">${p === '/' ? 'Home' : p}</a>`)}
    <span class="topbar__spacer"></span>
    <span class="customizer__devices" role="group" aria-label="Width">
      ${['desktop', 'tablet', 'mobile'].map((d) => html`<a class="btn ${d === 'desktop' ? '' : 'ghost'} small" href="${base}/themes/preview/${encodeURIComponent(slug)}?path=${encodeURIComponent(start)}&from=${encodeURIComponent(from)}#${d}" data-preview-device="${d}">${d}</a>`)}
    </span>
    ${active ? html`<span class="badge published">Active</span>` : html`
      <form method="post" action="${base}/themes/store/${encodeURIComponent(slug)}/install" class="inline">${csrfField(c)}<button class="btn small" type="submit">${installed ? 'Activate' : 'Install and activate'}</button><input type="hidden" name="activate" value="1"></form>
      <form method="post" action="${base}/themes/store/${encodeURIComponent(slug)}/install" class="inline">${csrfField(c)}<button class="btn ghost small" type="submit">${installed ? 'Reinstall' : 'Install only'}</button></form>`}
    <a class="btn ghost small" href="${from}">${t('themes.back_to_store')}</a>
  </div>
</div>
<div class="customizer__preview" data-device="desktop">
  <iframe id="theme-preview-frame" title="Preview of ${name}" src="/?preview=1&theme=${encodeURIComponent(slug)}${fresh ? '&v=' + encodeURIComponent(fresh) : ''}"
    sandbox="allow-same-origin allow-scripts allow-forms allow-popups" loading="lazy"></iframe>
</div>
<p class="hint">The frame is your own site with <code>&amp;theme=${esc(slug)}</code>. Drafts stay hidden: a preview link needs a signed-in admin.</p>
${raw(`<script>document.querySelectorAll('[data-preview-device]').forEach(function(a){a.addEventListener('click',function(){var p=document.querySelector('.customizer__preview');if(p)p.setAttribute('data-device',a.getAttribute('data-preview-device'));});});</script>`)}`, '/themes');
});

/**
 * A store theme's stylesheet, for the preview of a theme that is not installed.
 * Public only in the sense that publishes nothing private: it is one of the
 * app's own files, selected by a slug that must exist in the store.
 */
themes.get('/themes/preview/:slug/style.css', async (c) => {
  const slug = c.req.param('slug');
  const installed = await loadTheme(c.env, { slug });
  if (installed) {
    const asset = await getThemeAsset(c.env, slug, 'style.css');
    if (asset) {
      const body = asset.body instanceof ArrayBuffer ? asset.body : await new Response(asset.body).arrayBuffer();
      return new Response(body, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
  }
  const store = storeThemeFor(slug);
  if (!store) return errorPage(c, 404, 'Theme not found.');
  return new Response(store.css, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' } });
});

/* -------------------------------------------------------------- download */

/**
 * A theme exports as a zip that uploads back unchanged: `theme.json` with file
 * references, one file per template and partial, `style.css`, and every asset
 * byte-for-byte. A round trip through export → edit → upload therefore behaves
 * exactly like editing in the panel, because both go through parseManifest.
 */
themes.get('/themes/:id{[0-9]+}/download', async (c) => {
  const row = await themeRowById(c, Number(c.req.param('id')));
  if (!row) return errorPage(c, 404, 'Theme not found.');
  const assets = await listThemeAssets(c.env, row.slug);

  // The manifest names files rather than carrying their text, which is what a
  // zip-based theme looks like on disk.
  const files: { path: string; data: Uint8Array | string }[] = [];
  const templateRefs: Record<string, string> = {};
  for (const [name, body] of Object.entries(row.templates)) {
    files.push({ path: `${name}.html`, data: body });
    templateRefs[name] = `${name}.html`;
  }
  const partialRefs: Record<string, string> = {};
  for (const [name, body] of Object.entries(row.partials)) {
    files.push({ path: `partials/${name}.html`, data: body });
    partialRefs[name] = `partials/${name}.html`;
  }
  if (row.css) files.push({ path: 'style.css', data: row.css });

  const manifestOut: Record<string, unknown> = {
    ...row.manifest,
    name: row.name,
    slug: row.slug,
    version: row.version,
    templates: templateRefs,
    partials: partialRefs,
    assets: assets.map((a) => a.path),
  };
  if (row.css) manifestOut.css = 'style.css';
  files.unshift({ path: 'theme.json', data: JSON.stringify(manifestOut, null, 2) + '\n' });

  for (const asset of assets) {
    if (asset.path === 'style.css') continue;
    const file = await getThemeAsset(c.env, row.slug, asset.path);
    if (!file) continue;
    const bytes = file.body instanceof ArrayBuffer ? new Uint8Array(file.body) : new Uint8Array(await new Response(file.body).arrayBuffer());
    files.push({ path: asset.path, data: bytes });
  }

  const zip = zipFiles(files);
  await audit(c, 'exported', 'theme', `Exported theme “${row.name}” v${row.version}`, row.slug);
  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${row.slug}-${row.version}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
});

type ThemeRow = {
  id: number; slug: string; name: string; version: string; active: number;
  templates: Record<string, string>; partials: Record<string, string>; css: string;
  manifest: Record<string, unknown>; created_at: string;
};

/** One theme's stored text, parsed once for the export and the JSON view. */
async function themeRowById(c: Ctx, id: number): Promise<ThemeRow | null> {
  const raw = await c.env.DB.prepare('SELECT id, slug, name, version, active, templates, partials, css, manifest, created_at FROM themes WHERE id=?')
    .bind(id).first<{ id: number; slug: string; name: string; version: string; active: number; templates: string; partials: string; css: string; manifest: string; created_at: string }>();
  if (!raw) return null;
  const parse = <T,>(text: string, fallback: T): T => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: raw.id, slug: raw.slug, name: raw.name, version: raw.version, active: raw.active,
    templates: parse<Record<string, string>>(raw.templates, {}),
    partials: parse<Record<string, string>>(raw.partials || '{}', {}),
    css: raw.css,
    manifest: parse<Record<string, unknown>>(raw.manifest || '{}', {}),
    created_at: raw.created_at,
  };
}

/** The JSON form is still useful for reading a theme in a text editor or a diff. */
themes.get('/themes/:id{[0-9]+}/download.json', async (c) => {
  const row = await themeRowById(c, Number(c.req.param('id')));
  if (!row) return errorPage(c, 404, 'Theme not found.');
  const body = {
    ...row.manifest,
    name: row.name, slug: row.slug, version: row.version,
    templates: row.templates, partials: row.partials, css: row.css,
    assets: (await listThemeAssets(c.env, row.slug)).map((a) => a.path),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${row.slug}-theme.json"`,
      'Cache-Control': 'no-store',
    },
  });
});

export { getThemeAsset };
export default themes;
