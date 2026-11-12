import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { bumpCache, getSettings, setSettings } from '../../lib/config';
import { csrfField, errorPage, go, html, layout } from '../../lib/ui';

/**
 * Appearance: Customize (site-wide CSS and code) and Widgets (three footer
 * areas). Themes and Menus keep their own pages; this section groups them in
 * the sidebar. Code here is raw, so everything is admin-only.
 */
const appearance = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'admin')) return errorPage(c, 403, 'Only admins can change the appearance.');
  await next();
};
appearance.use('/appearance', guard);
appearance.use('/widgets', guard);

appearance.get('/appearance', async (c) => {
  const s = await getSettings(c.env);
  const base = c.var.base;
  const theme = await c.env.DB.prepare('SELECT name, version, slug FROM themes WHERE active=1 LIMIT 1')
    .first<{ name: string; version: string; slug: string }>();
  return layout(c, 'Customize', html`
<div class="row between" style="margin-bottom:1rem">
  <h1 style="margin:0">Customize</h1>
  <a class="btn ghost" href="/" target="_blank" rel="noopener">Preview site</a>
</div>
<div class="grid3" style="margin-bottom:1rem">
  <div class="tile"><b>${theme?.name ?? 'AMS Base'}</b><span>Active theme${theme ? ` · v${theme.version}` : ''}</span></div>
  <a class="tile" href="${base}/themes"><b>Themes</b><span>Install, switch, download or upload a theme</span></a>
  <a class="tile" href="${base}/menus"><b>Menus</b><span>Header and footer links</span></a>
</div>
<form method="post" action="${base}/appearance">
  ${csrfField(c)}
  <div class="card">
    <h2>Additional CSS</h2>
    <p class="hint" style="margin-top:0">Added after the theme stylesheet on every public page. Changes apply immediately.</p>
    <textarea id="custom_css" name="custom_css" class="code" spellcheck="false" placeholder=":root { --brand: #2457d6; }">${s.custom_css ?? ''}</textarea>
  </div>
  <div class="card">
    <h2>Header code</h2>
    <p class="hint" style="margin-top:0">Inside <code>&lt;head&gt;</code>: verification meta tags, analytics, preloads.</p>
    <textarea id="custom_head" name="custom_head" class="code" spellcheck="false" placeholder="&lt;meta name=&quot;google-site-verification&quot; content=&quot;…&quot;&gt;">${s.custom_head ?? ''}</textarea>
  </div>
  <div class="card">
    <h2>Footer code</h2>
    <p class="hint" style="margin-top:0">Appears after the theme footer, before the closing <code>&lt;/body&gt;</code>.</p>
    <textarea id="custom_footer" name="custom_footer" class="code" spellcheck="false">${s.custom_footer ?? ''}</textarea>
    <h2 style="margin-top:1rem">JavaScript</h2>
    <p class="hint" style="margin-top:0">Wrapped in a <code>&lt;script&gt;</code> tag for you. Keep the site usable without it.</p>
    <textarea id="custom_js" name="custom_js" class="code" spellcheck="false" placeholder="document.documentElement.classList.add('js');">${s.custom_js ?? ''}</textarea>
  </div>
  <p><button class="btn" type="submit">Save changes</button></p>
</form>
<div class="card">
  <h2>Widgets</h2>
  <p class="hint" style="margin-top:0">Three footer areas rendered in every theme. <a href="${base}/widgets">Edit the footer widgets</a>.</p>
  <p class="hint" style="margin-bottom:0">Looking for the favicon or site title? They live in <a href="${base}/settings">Settings → General</a>.</p>
</div>`, '/appearance');
});

appearance.post('/appearance', async (c) => {
  const f = c.var.form;
  const field = (k: string, max: number) => String(f.get(k) ?? '').slice(0, max).trim();
  await setSettings(c.env, {
    custom_css: field('custom_css', 100000),
    custom_head: field('custom_head', 50000),
    custom_footer: field('custom_footer', 50000),
    custom_js: field('custom_js', 50000),
  });
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/appearance', { ok: 'Appearance saved. Every page is up to date.' });
});

/* ------------------------------------------------------------------ widgets */
appearance.get('/widgets', async (c) => {
  const s = await getSettings(c.env);
  const base = c.var.base;
  return layout(c, 'Widgets', html`
<div class="row between" style="margin-bottom:1rem">
  <h1 style="margin:0">Widgets</h1>
  <a class="btn ghost" href="${base}/appearance">Customize</a>
</div>
<p class="muted" style="margin-top:0">Three footer areas. Leave a slot empty to hide it. Titles are plain text; bodies accept HTML.</p>
<form method="post" action="${base}/widgets">
  ${csrfField(c)}
  <div class="card">
    ${[1, 2, 3].map((n) => html`<div class="widget-slot">
      <h2>Footer ${n}</h2>
      <label for="widget_footer_${n}_title">Title</label>
      <input type="text" id="widget_footer_${n}_title" name="widget_footer_${n}_title" value="${s[`widget_footer_${n}_title`] ?? ''}" maxlength="120" placeholder="Optional">
      <label for="widget_footer_${n}_body">Content</label>
      <textarea id="widget_footer_${n}_body" name="widget_footer_${n}_body" maxlength="5000" placeholder="&lt;p&gt;About this site…&lt;/p&gt;">${s[`widget_footer_${n}_body`] ?? ''}</textarea>
    </div>`)}
  </div>
  <p><button class="btn" type="submit">Save widgets</button></p>
</form>`, '/widgets');
});

appearance.post('/widgets', async (c) => {
  const f = c.var.form;
  const values: Record<string, string> = {};
  for (const n of [1, 2, 3]) {
    values[`widget_footer_${n}_title`] = String(f.get(`widget_footer_${n}_title`) ?? '').slice(0, 120).trim();
    values[`widget_footer_${n}_body`] = String(f.get(`widget_footer_${n}_body`) ?? '').slice(0, 5000).trim();
  }
  await setSettings(c.env, values);
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/widgets', { ok: 'Widgets saved.' });
});

export default appearance;
