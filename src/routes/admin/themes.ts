import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { bumpCache } from '../../lib/config';
import { MAX_THEME_UPLOAD, ThemeError, readThemeUpload, restoreDefaultTheme, saveTheme } from '../../lib/themes';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';
import { TEMPLATE_NAMES, defaultTheme } from '../../themes/default';

/** Themes contain raw HTML and scripts, so everything here is admin-only. */
const themes = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'admin')) return errorPage(c, 403, 'Only admins can manage themes.');
  await next();
};
themes.use('/themes', guard);
themes.use('/themes/*', guard);

type ThemeRow = { id: number; slug: string; name: string; version: string; templates: string; css: string; active: number; created_at: string };

themes.get('/themes', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, slug, name, version, templates, active FROM themes ORDER BY active DESC, name').all<ThemeRow>();
  const base = c.var.base;
  return layout(c, 'Themes', html`
<h1>Themes</h1>
<div class="card">
  <ul class="list">
    ${results.map((t) => {
      let parts: string[] = [];
      try { parts = Object.keys(JSON.parse(t.templates)); } catch { /* shown as empty */ }
      return html`<li style="flex-wrap:wrap">
        <div class="t"><a href="${base}/themes/${t.id}/download">${t.name}</a><small>v${t.version} · templates: ${parts.join(', ') || 'none'}</small></div>
        ${t.active ? html`<span class="badge published">Active</span>` : html`
          <form method="post" action="${base}/themes/${t.id}/activate" class="inline">${csrfField(c)}<button class="btn small" type="submit">Activate</button></form>
          <form method="post" action="${base}/themes/${t.id}/delete" class="inline" data-confirm="Delete the theme &quot;${t.name}&quot;?">${csrfField(c)}<button class="btn danger small" type="submit">Delete</button></form>`}
        <a class="btn ghost small" href="${base}/themes/${t.id}/download">Download</a>
      </li>`;
    })}
  </ul>
</div>
<form method="post" action="${base}/themes/upload" enctype="multipart/form-data" class="card">
  ${csrfField(c)}
  <h2>Add a theme</h2>
  <label for="theme" style="margin-top:0">Theme file (.json or .zip)</label>
  <input type="file" id="theme" name="theme" accept=".json,.zip,application/json,application/zip" required>
  <p class="hint">Up to ${String(MAX_THEME_UPLOAD / 1048576)} MB. Uploading a theme with the same name replaces that theme. Only install themes you trust: a theme can run scripts on your site.</p>
  <p style="margin:.8rem 0 0"><button class="btn" type="submit">Upload theme</button></p>
</form>
<div class="card">
  <h2>Make your own</h2>
  <p>Download a theme above, edit the file, and upload it again. A theme is one JSON file:</p>
  <pre class="pre">{
  "name": "My Theme",
  "version": "1.0.0",
  "templates": {
    "base": "&lt;!doctype html&gt; ... {{{content}}} ...",
    "home": "...", "page": "...", "post": "...", "archive": "...", "404": "..."
  },
  "css": "body { ... }"
}</pre>
  <p class="hint">Only <b>base</b> is required; the others fall back to the Default theme. Or upload a .zip with <code>theme.json</code> next to <code>${TEMPLATE_NAMES.map((n) => n + '.html').join(', ')}</code> and <code>style.css</code>. Template tags are listed in the README.</p>
  <form method="post" action="${base}/themes/restore-default">${csrfField(c)}<button class="btn ghost small" type="submit">Restore the built-in Default theme (v${defaultTheme.version})</button></form>
</div>
${raw(`<script>document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm(f.getAttribute('data-confirm')))e.preventDefault()})});</script>`)}`, '/themes');
});

themes.post('/themes/upload', async (c) => {
  const file = c.var.form.get('theme');
  if (!file || typeof file === 'string' || !file.size) return go(c, '/themes', { err: 'Choose a theme file.' });
  if (file.size > MAX_THEME_UPLOAD) return go(c, '/themes', { err: 'The file is too large (limit 2 MB).' });
  try {
    const theme = await readThemeUpload(await file.arrayBuffer());
    await saveTheme(c.env, theme);
    await bumpCache(c.env, c.var.cfg); // the uploaded theme may be the active one
    return go(c, '/themes', { ok: `Theme "${theme.name}" v${theme.version} saved. Activate it to use it.` });
  } catch (err) {
    if (err instanceof ThemeError) return go(c, '/themes', { err: err.message });
    throw err;
  }
});

themes.post('/themes/restore-default', async (c) => {
  await restoreDefaultTheme(c.env);
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/themes', { ok: 'Default theme restored.' });
});

themes.post('/themes/:id{[0-9]+}/activate', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await c.env.DB.prepare('SELECT 1 AS x FROM themes WHERE id=?').bind(id).first())) return errorPage(c, 404, 'Theme not found.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE themes SET active=0 WHERE id<>?').bind(id),
    c.env.DB.prepare('UPDATE themes SET active=1 WHERE id=?').bind(id),
  ]);
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/themes', { ok: 'Theme activated.' });
});

themes.post('/themes/:id{[0-9]+}/delete', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT active FROM themes WHERE id=?').bind(id).first<{ active: number }>();
  if (!row) return errorPage(c, 404, 'Theme not found.');
  if (row.active) return go(c, '/themes', { err: 'Activate another theme before deleting this one.' });
  await c.env.DB.prepare('DELETE FROM themes WHERE id=?').bind(id).run();
  return go(c, '/themes', { ok: 'Theme deleted.' });
});

themes.get('/themes/:id{[0-9]+}/download', async (c) => {
  const t = await c.env.DB.prepare('SELECT slug, name, version, templates, css FROM themes WHERE id=?').bind(Number(c.req.param('id'))).first<ThemeRow>();
  if (!t) return errorPage(c, 404, 'Theme not found.');
  const bundle = { name: t.name, slug: t.slug, version: t.version, templates: JSON.parse(t.templates), css: t.css };
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${t.slug}-theme.json"`, 'Cache-Control': 'no-store' },
  });
});

export default themes;
