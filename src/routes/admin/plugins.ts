import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { bumpCache, getSettings, setSettings } from '../../lib/config';
import { BUILTIN_PLUGINS, HOOK_POINTS, VERIFICATION_ENGINES, extractVerificationCode, isHookPoint, listHooks, pluginOn, pluginSetting, verificationMetaTag, type HookRow } from '../../lib/plugins';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';

/**
 * Plugins. Two kinds:
 *  - built-in features (sitemap, robots.txt, RSS) that can be switched on/off;
 *  - snippets: small pieces of HTML attached to <head> or before </body>.
 * Snippet code is raw, so this section is admin-only.
 */
const plugins = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'manage_plugins')) return errorPage(c, 403, 'Only admins can manage plugins.');
  await next();
};
plugins.use('/plugins', guard);
plugins.use('/plugins/*', guard);

const MAX_CODE = 20000;

function snippetForm(c: Ctx, row: HookRow | null, error = ''): Promise<Response> {
  const base = c.var.base;
  return layout(c, row ? `Edit ${row.name}` : 'Add plugin', html`
<div class="row between" style="margin-bottom:1rem">
  <h1 style="margin:0">${row ? 'Edit plugin' : 'Add plugin'}</h1>
  <a href="${base}/plugins">&larr; Plugins</a>
</div>
${error ? html`<div class="flash err" role="alert">${error}</div>` : ''}
<form method="post" action="${base}/plugins/save" class="card">
  ${csrfField(c)}
  <input type="hidden" name="id" value="${row?.id ?? ''}">
  <label for="name" style="margin-top:0">Name</label>
  <input type="text" id="name" name="name" value="${row?.name ?? ''}" required maxlength="120" placeholder="Analytics tag">
  <label for="hook">Where the code goes</label>
  <select id="hook" name="hook">
    ${HOOK_POINTS.map((h) => html`<option value="${h.value}"${row?.hook === h.value ? raw(' selected') : ''}>${h.label}</option>`)}
  </select>
  <label for="code">Code (HTML)</label>
  <textarea id="code" name="code" class="code" spellcheck="false" required maxlength="${MAX_CODE}" placeholder="&lt;meta name=&quot;example&quot; content=&quot;value&quot;&gt;">${row?.code ?? ''}</textarea>
  <p class="hint">Added to every public page while the plugin is active. Admins only: the code is not sanitized.</p>
  <label class="check" style="margin-top:.9rem"><input type="checkbox" name="enabled" value="1"${row ? (row.enabled ? raw(' checked') : '') : raw(' checked')}> Active</label>
  <p style="margin:1.1rem 0 0"><button class="btn" type="submit">${row ? 'Save plugin' : 'Add plugin'}</button></p>
</form>`, '/plugins');
}

plugins.get('/plugins', async (c) => {
  const [settings, snippets] = await Promise.all([getSettings(c.env), listHooks(c.env)]);
  const base = c.var.base;
  return layout(c, 'Plugins', html`
<div class="row between" style="margin-bottom:1rem">
  <h1 style="margin:0">Plugins</h1>
  <a class="btn" href="${base}/plugins/new">Add plugin</a>
</div>
<h2>Built-in</h2>
<div class="card">
  <ul class="list">
    ${BUILTIN_PLUGINS.map((p) => {
      const on = pluginOn(settings, p.key);
      return html`<li>
        <div class="t"><b>${p.name}</b> <span class="pill ${on ? 'on' : 'off'}">${on ? 'Active' : 'Inactive'}</span>
          <small>${p.description}${p.configureUrl ? html` · <a href="${base}${p.configureUrl}">Configure</a>` : ''}${on && p.adminUrl ? html` · <a href="${p.adminUrl}" target="_blank" rel="noopener">Open</a>` : ''}</small></div>
        <form method="post" action="${base}/plugins/toggle" class="inline">
          ${csrfField(c)}<input type="hidden" name="key" value="${p.key}">
          <button class="btn ${on ? 'ghost' : ''} small" type="submit">${on ? 'Deactivate' : 'Activate'}</button>
        </form>
      </li>`;
    })}
  </ul>
</div>
<h2 style="margin-top:1.4rem">Your plugins (${snippets.length})</h2>
<div class="card">
  ${snippets.length ? html`<ul class="list">
    ${snippets.map((h) => html`<li>
      <div class="t"><a href="${base}/plugins/${h.id}">${h.name}</a>
        <small>${HOOK_POINTS.find((p) => p.value === h.hook)?.label ?? h.hook} · ${h.code.length} characters · added ${h.created_at.slice(0, 10)}</small></div>
      <span class="pill ${h.enabled ? 'on' : 'off'}">${h.enabled ? 'Active' : 'Inactive'}</span>
      <form method="post" action="${base}/plugins/${h.id}/toggle" class="inline">
        ${csrfField(c)}<button class="btn ghost small" type="submit">${h.enabled ? 'Deactivate' : 'Activate'}</button>
      </form>
      <form method="post" action="${base}/plugins/${h.id}/delete" class="inline" data-confirm>
        ${csrfField(c)}<button class="btn danger small" type="submit">Delete</button>
      </form>
    </li>`)}
  </ul>` : html`<p class="muted" style="margin:0">No custom plugins yet. Add one to inject analytics, a chat widget, verification meta tags or a stylesheet.</p>`}
</div>
<div class="card">
  <h2>Plugin hooks</h2>
  <p class="hint" style="margin-top:0">Every snippet runs on each public page in the hook you choose:</p>
  <ul class="list">
    ${HOOK_POINTS.map((h) => html`<li><div class="t"><b>${h.value}</b><small>${h.label}</small></div></li>`)}
  </ul>
  <p class="hint" style="margin-bottom:0">Code from plugins is trusted like theme code. Only add code you understand.</p>
</div>
${raw(`<script>document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm('Delete this plugin? Its code is removed from the site.'))e.preventDefault()})});</script>`)}`, '/plugins');
});


/* ------------------------------------------- Search Console Verification */
/**
 * Built-in plugin screen: paste a verification tag (or bare code) per search
 * engine, save, and the exact <meta> tag is live in <head> on the next request.
 * Saving always (re)activates the plugin — that is the "paste and boom" flow.
 */
plugins.get('/plugins/search-verification', async (c) => {
  const s = await getSettings(c.env);
  const base = c.var.base;
  const on = pluginOn(s, 'search-verification');
  const origin = new URL(c.req.url).origin;
  return layout(c, 'Search Console Verification', html`
<div class="row between" style="margin-bottom:1rem">
  <h1 style="margin:0">Search Console Verification</h1>
  <a href="${base}/plugins">&larr; Plugins</a>
</div>
<div class="card">
  <p style="margin-top:0"><span class="pill ${on ? 'on' : 'off'}">${on ? 'Active' : 'Inactive'}</span>
  <span class="hint" style="margin-left:.5rem">Built-in plugin — installed and ready. It prints your verification <code>&lt;meta&gt;</code> tags inside <code>&lt;head&gt;</code> on every public page.</span></p>
  <ol class="hint" style="margin:.6rem 0 0;padding-left:1.2rem">
    <li>In <a href="https://search.google.com/search-console" target="_blank" rel="noopener">Google Search Console</a> choose <b>Add property → URL prefix</b>, enter <code>${origin}/</code>, then pick the <b>HTML tag</b> method.</li>
    <li>Copy the tag Google shows and paste it below (pasting only the code inside <code>content="…"</code> works too).</li>
    <li>Press <b>Save &amp; activate</b>, go back to Google and press <b>Verify</b>. Done — no theme or file editing.</li>
  </ol>
</div>
<form method="post" action="${base}/plugins/search-verification" class="card">
  ${csrfField(c)}
  ${VERIFICATION_ENGINES.map((e) => {
    const token = extractVerificationCode(s[e.setting] || '', e.metaName);
    const tag = token ? verificationMetaTag(e, token) : '';
    return html`
  <h2 style="margin-bottom:.3rem">${e.label}</h2>
  <p class="hint" style="margin-top:0">${e.help}</p>
  <label for="verify-${e.key}">Verification tag or code</label>
  <textarea id="verify-${e.key}" name="${e.setting}" class="code" rows="2" spellcheck="false" placeholder="&lt;meta name=&quot;${e.metaName}&quot; content=&quot;…&quot;&gt;">${tag || (s[e.setting] ?? '')}</textarea>
  ${token
    ? html`<p class="hint" role="status">✓ Live tag: <code>${tag}</code></p>`
    : html`<p class="hint">Not set yet — nothing is printed for ${e.label}.</p>`}`;
  })}
  <p class="row" style="margin:1.1rem 0 0"><button class="btn" type="submit">Save &amp; activate</button>
  <a class="btn ghost" href="/" target="_blank" rel="noopener">View homepage source to check</a></p>
  <p class="hint">To stop printing the tags, clear a box and save, or deactivate the plugin on the Plugins screen. Tip: after verifying, also submit your sitemap in Search Console: <code>${origin}/sitemap.xml</code>.</p>
</form>`, '/plugins');
});

plugins.post('/plugins/search-verification', async (c) => {
  const values: Record<string, string> = { [pluginSetting('search-verification')]: '1' };
  for (const e of VERIFICATION_ENGINES) {
    const pasted = String(c.var.form.get(e.setting) ?? '');
    const token = extractVerificationCode(pasted, e.metaName);
    if (pasted.trim() && !token) {
      return go(c, '/plugins/search-verification', { err: `${e.label}: could not find a verification code in what you pasted. Paste the whole <meta …> tag or only the code inside content="…".` });
    }
    values[e.setting] = token;
  }
  await setSettings(c.env, values);
  await bumpCache(c.env, c.var.cfg);
  const active = VERIFICATION_ENGINES.filter((e) => values[e.setting]).map((e) => e.label);
  return go(c, '/plugins/search-verification', {
    ok: active.length
      ? `Saved and active — verification tag live in <head> for ${active.join(', ')}. Now press Verify in Search Console.`
      : 'Saved. Paste a verification tag to make it live.',
  });
});

plugins.post('/plugins/toggle', async (c) => {
  const key = String(c.var.form.get('key') ?? '');
  const plugin = BUILTIN_PLUGINS.find((p) => p.key === key);
  if (!plugin) return go(c, '/plugins', { err: 'Unknown plugin.' });
  const settings = await getSettings(c.env);
  const next = !pluginOn(settings, key);
  await setSettings(c.env, { [pluginSetting(key)]: next ? '1' : '0' });
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/plugins', { ok: `${plugin.name} ${next ? 'activated' : 'deactivated'}.` });
});

plugins.get('/plugins/new', (c) => snippetForm(c, null));

plugins.get('/plugins/:id{[0-9]+}', async (c) => {
  const row = await c.env.DB.prepare('SELECT id, name, hook, code, enabled, created_at FROM hooks WHERE id=? AND site_id=1')
    .bind(Number(c.req.param('id'))).first<HookRow>();
  if (!row) return errorPage(c, 404, 'Plugin not found.');
  return snippetForm(c, row);
});

plugins.post('/plugins/save', async (c) => {
  const f = c.var.form;
  const id = Number(f.get('id')) || 0;
  const name = String(f.get('name') ?? '').trim().slice(0, 120);
  const hook = String(f.get('hook') ?? '');
  const code = String(f.get('code') ?? '').slice(0, MAX_CODE);
  const enabled = f.get('enabled') === '1' ? 1 : 0;
  const existing = id
    ? await c.env.DB.prepare('SELECT id, name, hook, code, enabled, created_at FROM hooks WHERE id=? AND site_id=1').bind(id).first<HookRow>()
    : null;
  if (id && !existing) return errorPage(c, 404, 'Plugin not found.');
  if (!name) return snippetForm(c, existing, 'Give the plugin a name.');
  if (!isHookPoint(hook)) return snippetForm(c, existing, 'Choose where the code goes.');
  if (!code.trim()) return snippetForm(c, existing, 'The plugin needs some code.');

  const now = new Date().toISOString();
  if (existing) {
    await c.env.DB.prepare('UPDATE hooks SET name=?, hook=?, code=?, enabled=? WHERE id=?')
      .bind(name, hook, code, enabled, id).run();
  } else {
    await c.env.DB.prepare('INSERT INTO hooks (site_id,hook,name,code,enabled,created_at) VALUES (1,?,?,?,?,?)')
      .bind(hook, name, code, enabled, now).run();
  }
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/plugins', { ok: `${name} saved.` });
});

plugins.post('/plugins/:id{[0-9]+}/toggle', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT id, name, enabled FROM hooks WHERE id=? AND site_id=1').bind(id)
    .first<{ id: number; name: string; enabled: number }>();
  if (!row) return errorPage(c, 404, 'Plugin not found.');
  await c.env.DB.prepare('UPDATE hooks SET enabled=? WHERE id=?').bind(row.enabled ? 0 : 1, id).run();
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/plugins', { ok: `${row.name} ${row.enabled ? 'deactivated' : 'activated'}.` });
});

plugins.post('/plugins/:id{[0-9]+}/delete', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT name FROM hooks WHERE id=? AND site_id=1').bind(id).first<{ name: string }>();
  if (!row) return errorPage(c, 404, 'Plugin not found.');
  await c.env.DB.prepare('DELETE FROM hooks WHERE id=?').bind(id).run();
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/plugins', { ok: `${row.name} deleted.` });
});

export default plugins;
