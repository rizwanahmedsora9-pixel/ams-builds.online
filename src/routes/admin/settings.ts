import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { can } from '../../lib/auth';
import { getSettings, saveConfig, setSettings, validAdminSlug } from '../../lib/config';
import { cleanDomain, safeUrl } from '../../lib/security';
import { validTimezone } from '../../lib/time';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';

const settings = new Hono<AppEnv>();

settings.use('/settings', async (c, next) => {
  if (!can(c.var.user, 'admin')) return errorPage(c, 403, 'Only admins can change settings.');
  await next();
});

const COMMON_ZONES = ['UTC', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
  'Europe/London', 'Europe/Berlin', 'Europe/Istanbul', 'Africa/Cairo', 'Africa/Lagos', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Sao_Paulo'];

settings.get('/settings', async (c) => {
  const s = await getSettings(c.env);
  const cfg = c.var.cfg;
  const { results: pages } = await c.env.DB.prepare("SELECT id, title FROM content WHERE site_id=1 AND type='page' ORDER BY title").all<{ id: number; title: string }>();
  const sel = (on: boolean) => (on ? raw(' selected') : '');
  const style = s.permalink_style || 'blog';
  const extra = cfg.domains.filter((d) => d !== cfg.primaryDomain).join('\n');
  return layout(c, 'Settings', html`
<h1>Settings</h1>
<form method="post" action="${c.var.base}/settings">
  ${csrfField(c)}
  <div class="card">
    <h2>Site</h2>
    <label for="site_title" style="margin-top:0">Site title</label>
    <input type="text" id="site_title" name="site_title" value="${s.site_title ?? ''}" required maxlength="120">
    <label for="tagline">Tagline</label>
    <input type="text" id="tagline" name="tagline" value="${s.tagline ?? ''}" maxlength="200">
    <label for="favicon">Favicon URL</label>
    <input type="text" id="favicon" name="favicon" value="${s.favicon ?? ''}" placeholder="/media/2026/01/abc-icon.png">
    <p class="hint">Upload an icon in Media and paste its URL here.</p>
    <label for="timezone">Timezone</label>
    <input type="text" id="timezone" name="timezone" value="${s.timezone || 'UTC'}" list="zones" required autocapitalize="none">
    <datalist id="zones">${COMMON_ZONES.map((z) => html`<option value="${z}">`)}</datalist>
    <p class="hint">IANA name, e.g. Asia/Karachi. Used for post dates and scheduling.</p>
  </div>
  <div class="card">
    <h2>Reading</h2>
    <label for="home_page_id" style="margin-top:0">Home page</label>
    <select id="home_page_id" name="home_page_id">
      <option value="">Latest posts only</option>
      ${pages.map((p) => html`<option value="${p.id}"${sel(String(p.id) === s.home_page_id)}>${p.title}</option>`)}
    </select>
    <label for="posts_per_page">Posts per page</label>
    <input type="number" id="posts_per_page" name="posts_per_page" value="${s.posts_per_page || '10'}" min="1" max="50" required>
    <label for="permalink_style">Post permalinks</label>
    <select id="permalink_style" name="permalink_style">
      <option value="blog"${sel(style === 'blog')}>/blog/post-name</option>
      <option value="plain"${sel(style === 'plain')}>/post-name</option>
      <option value="dated"${sel(style === 'dated')}>/2026/01/post-name</option>
    </select>
  </div>
  <div class="card">
    <h2>Domains &amp; admin URL</h2>
    <label for="primary_domain" style="margin-top:0">Primary domain</label>
    <input type="text" id="primary_domain" name="primary_domain" value="${cfg.primaryDomain}" required autocapitalize="none">
    <label for="domains">Additional domains</label>
    <textarea id="domains" name="domains" placeholder="one per line" autocapitalize="none">${extra}</textarea>
    <p class="hint">The site answers on every hostname routed to the Worker; this list records the ones you use.</p>
    <label for="admin_slug">Admin URL slug</label>
    <input type="text" id="admin_slug" name="admin_slug" value="${cfg.adminSlug}" required pattern="[a-z0-9][a-z0-9\\-]{2,40}" autocapitalize="none">
    <p class="hint">Changing this moves the admin panel to the new address immediately.</p>
  </div>
  <p><button class="btn" type="submit">Save settings</button></p>
</form>`, '/settings');
});

settings.post('/settings', async (c) => {
  const f = c.var.form;
  const str = (k: string) => String(f.get(k) ?? '').trim();
  const cfg = c.var.cfg;

  const siteTitle = str('site_title').slice(0, 120);
  const timezone = str('timezone');
  const primary = cleanDomain(str('primary_domain'));
  const slug = str('admin_slug').toLowerCase();
  if (!siteTitle) return go(c, '/settings', { err: 'Site title is required.' });
  if (!validTimezone(timezone)) return go(c, '/settings', { err: `Unknown timezone "${timezone}".` });
  if (!primary) return go(c, '/settings', { err: 'Enter a valid primary domain.' });
  if (!validAdminSlug(slug)) return go(c, '/settings', { err: 'Admin slug: 3-41 lowercase letters, digits or dashes, and not a reserved path.' });
  if (slug !== cfg.adminSlug && (await c.env.DB.prepare("SELECT 1 AS x FROM content WHERE site_id=1 AND type='page' AND slug=?").bind(slug).first())) {
    return go(c, '/settings', { err: 'A page already uses that slug.' });
  }

  const favicon = str('favicon');
  const homeId = Number(str('home_page_id')) || 0;
  const homeOk = homeId && (await c.env.DB.prepare("SELECT 1 AS x FROM content WHERE id=? AND site_id=1 AND type='page'").bind(homeId).first());
  const style = ['blog', 'plain', 'dated'].includes(str('permalink_style')) ? str('permalink_style') : 'blog';
  const domains = [...new Set([primary, ...str('domains').split(/[\s,]+/).map(cleanDomain).filter(Boolean)])].slice(0, 50);

  await setSettings(c.env, {
    site_title: siteTitle,
    tagline: str('tagline').slice(0, 200),
    favicon: favicon ? safeUrl(favicon) : '',
    timezone,
    home_page_id: homeOk ? String(homeId) : '',
    posts_per_page: String(Math.min(50, Math.max(1, Number(str('posts_per_page')) || 10))),
    permalink_style: style,
    domains: domains.join('\n'),
  });
  await c.env.DB.prepare('UPDATE sites SET hostname=?, name=? WHERE id=1').bind(primary, siteTitle).run();

  // One KV write: new config + new cache generation (every cached page is now stale).
  cfg.adminSlug = slug;
  cfg.primaryDomain = primary;
  cfg.domains = domains;
  cfg.cacheV = Date.now();
  await saveConfig(c.env, cfg);
  return c.redirect(`/${slug}/settings?ok=${encodeURIComponent('Settings saved.')}`, 303);
});

export default settings;
