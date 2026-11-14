import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { bumpCache, getSettings } from '../../lib/config';
import { SCHEMA_VERSION, installedSchemaVersion, migrate, pendingMigrations } from '../../db/migrations';
import { BUILTIN_PLUGINS, pluginOn } from '../../lib/plugins';
import { csrfField, errorPage, go, html, layout } from '../../lib/ui';
import { APP_NAME, APP_VERSION } from '../../lib/version';

/**
 * Updates: one page that answers "is everything current?".
 *  - the CMS version and how to deploy a new one;
 *  - database migrations that have not run yet (and a button to run them now);
 *  - which theme is active (the app ships none, so a site without one is told);
 *  - plugin states and the last backup.
 */
const updates = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'manage_updates')) return errorPage(c, 403, 'Only admins can see updates.');
  await next();
};
updates.use('/updates', guard);
updates.use('/updates/*', guard);

updates.get('/updates', async (c) => {
  const base = c.var.base;
  const [schema, settings, themes, snippets, backups] = await Promise.all([
    installedSchemaVersion(c.env).catch(() => 1),
    getSettings(c.env),
    c.env.DB.prepare('SELECT slug, name, version, active FROM themes ORDER BY name')
      .all<{ slug: string; name: string; version: string; active: number }>().catch(() => ({ results: [] as { slug: string; name: string; version: string; active: number }[] })),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM hooks WHERE site_id=1').first<{ n: number }>().catch(() => null),
    c.env.DB.prepare('SELECT created_at FROM backups ORDER BY id DESC LIMIT 1').first<{ created_at: string }>().catch(() => null),
  ]);
  const pending = pendingMigrations(schema);
  const activeTheme = themes.results.find((t) => t.active);
  const lastChecked = new Date().toISOString().replace('T', ' ').slice(0, 19);

  return layout(c, 'Updates', html`
<h1>Updates</h1>
<div class="stats">
  <div class="stat"><b>${APP_VERSION}</b><span>${APP_NAME}</span></div>
  <div class="stat"><b>${schema}</b><span>Database schema</span></div>
  <div class="stat"><b>${pending.length}</b><span>Pending updates</span></div>
  <div class="stat"><b>${themes.results.length}</b><span>Themes installed</span></div>
</div>

<div class="card">
  <div class="row between">
    <h2 style="margin:0">Core</h2>
    <span class="pill ${pending.length ? 'off' : 'on'}">${pending.length ? 'Update available' : 'Up to date'}</span>
  </div>
  <dl class="kv" style="margin-top:.8rem">
    <dt>Installed version</dt><dd>${APP_VERSION}</dd>
    <dt>Database schema</dt><dd>${schema} of ${SCHEMA_VERSION}</dd>
    <dt>Active theme</dt><dd>${activeTheme ? `${activeTheme.name} v${activeTheme.version}` : 'None — the site renders bare, unstyled HTML'}</dd>
    <dt>Last checked</dt><dd>${lastChecked} UTC</dd>
  </dl>
  ${pending.length ? html`
    <p class="notice" style="margin-top:.9rem">Database updates are waiting. They add new tables and columns without touching your content.</p>
    <ul class="list">${pending.map((m) => html`<li><div class="t"><b>${m.name}</b><small>schema version ${m.version}</small></div></li>`)}</ul>
    <form method="post" action="${base}/updates/run" style="margin-top:.9rem">${csrfField(c)}<button class="btn" type="submit">Run ${pending.length} update${pending.length === 1 ? '' : 's'} now</button></form>` : html`
    <p class="hint" style="margin-bottom:0">Nothing to do. Updates also run automatically on a schedule.</p>`}
</div>

<div class="card">
  <h2>How to update the CMS</h2>
  <p class="hint" style="margin-top:0">The code updates when you deploy a newer version. Your content, media, themes and settings are kept.</p>
  <ul class="list">
    <li><div class="t"><b>Cloudflare Workers</b><small>Push to the connected repository, or run <code>npx wrangler deploy</code>. Wrangler prints the new version when it finishes.</small></div></li>
    <li><div class="t"><b>Your own server</b><small>Pull the repository, run <code>npm install &amp;&amp; npm run build</code>, then restart the service. <code>data/</code> is untouched.</small></div></li>
    <li><div class="t"><b>Database</b><small>Pending migrations are applied by the cron trigger every few minutes, by <code>npm start</code>, or right here with the button above.</small></div></li>
  </ul>
</div>

<div class="card">
  <h2>Themes</h2>
  ${activeTheme ? html`
    <p class="hint" style="margin:0">Active: <b>${activeTheme.name}</b> v${activeTheme.version}. The app ships no themes of its own, so whatever is installed here is yours.</p>
    <p style="margin:.8rem 0 0"><a class="btn ghost small" href="${base}/themes">Manage themes</a></p>` : html`
    <p class="notice" style="margin:0">No theme is active. The site renders bare, unstyled HTML — a clean slate — until you upload a theme and activate it.</p>
    <p style="margin:.8rem 0 0"><a class="btn small" href="${base}/themes">Upload a theme</a></p>`}
</div>

<div class="card">
  <h2>Plugins</h2>
  <ul class="list">
    ${BUILTIN_PLUGINS.map((p) => {
      const on = pluginOn(settings, p.key);
      return html`<li><div class="t"><b>${p.name}</b><small>Built in · ${on ? 'active' : 'inactive'}</small></div><span class="pill ${on ? 'on' : 'off'}">${on ? 'Current' : 'Off'}</span></li>`;
    })}
    <li><div class="t"><b>Your snippets</b><small>${snippets?.n ?? 0} custom plugin${(snippets?.n ?? 0) === 1 ? '' : 's'} attached to the site</small></div><a class="btn ghost small" href="${base}/plugins">Manage</a></li>
  </ul>
</div>

<div class="card">
  <h2>Backups</h2>
  <p class="hint" style="margin-top:0">${backups?.created_at ? `Last backup: ${backups.created_at.slice(0, 16).replace('T', ' ')} UTC.` : 'No backup has been made yet.'}</p>
  <a class="btn ghost small" href="${base}/tools/backups">Open backups</a>
</div>`, '/updates');
});

updates.post('/updates/run', async (c) => {
  const before = await installedSchemaVersion(c.env).catch(() => 1);
  const after = await migrate(c.env);
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/updates', {
    ok: after > before ? `Database updated to schema version ${after}.` : 'Everything was already up to date.',
  });
});

export default updates;
