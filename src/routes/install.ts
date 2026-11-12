import { Hono } from 'hono';
import type { Config, Env } from '../types';
import { createSchema, dbHasUsers } from '../db';
import { SCHEMA_VERSION } from '../db/migrations';
import { hashPassword, randomToken } from '../lib/auth';
import { markInstalled, saveConfig, validAdminSlug } from '../lib/config';
import { cleanDomain, sameOrigin } from '../lib/security';
import { displayTitle, siteNameFromHost } from '../lib/origin';
import { html, raw, shell, type Raw } from '../lib/ui';
import { defaultTheme } from '../themes/default';

/**
 * First-run wizard. The root app only routes here while the KV "installed"
 * flag is absent; afterwards /install is a 404 forever. D1 (strongly
 * consistent) is checked as well so a second install can never slip through
 * while the KV flag is still propagating.
 */
const install = new Hono<{ Bindings: Env }>();

type Values = Record<'username' | 'email' | 'title' | 'domain' | 'slug', string>;

function wizard(v: Values, errors: string[] = []): string {
  const body: Raw = html`
<div class="auth">
  <h1>Install your site</h1>
  <p class="muted" style="text-align:center" id="stepno">Step 1 of 3</p>
  ${errors.length ? html`<div class="flash err" role="alert">${errors.map((e) => html`<div>${e}</div>`)}</div>` : ''}
  <form method="post" action="/install" class="card" id="wiz" autocomplete="off">
    <section data-step>
      <h2>1. Admin account</h2>
      <label for="username">Username</label>
      <input type="text" id="username" name="username" value="${v.username}" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_.\\-]+" autocapitalize="none">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" value="${v.email}" required>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required minlength="8" autocomplete="new-password">
      <p class="hint">At least 8 characters.</p>
      <label for="password2">Repeat password</label>
      <input type="password" id="password2" name="password2" required minlength="8" autocomplete="new-password">
    </section>
    <section data-step>
      <h2>2. Site</h2>
      <label for="title">Site title</label>
      <input type="text" id="title" name="title" value="${v.title}" required maxlength="120">
      <p class="hint">Leave this as it is to take the name from your domain, whatever domain the site is opened on.</p>
      <label for="domain">Primary domain</label>
      <input type="text" id="domain" name="domain" value="${v.domain}" required autocapitalize="none">
      <p class="hint">Without https://. The site also keeps answering on any other domain routed to this Worker.</p>
      <label for="slug">Admin URL slug</label>
      <input type="text" id="slug" name="slug" value="${v.slug}" required pattern="[a-z0-9][a-z0-9\\-]{2,40}" autocapitalize="none">
      <p class="hint">Your admin panel will live at /<span id="slugshow">${v.slug}</span></p>
    </section>
    <section data-step>
      <h2>3. Install</h2>
      <p>This creates the database tables, the default theme and a sample home page, then locks the installer.</p>
      <p class="hint">Built the site wrong later? An admin can reopen this wizard with <b>Tools &rarr; Danger zone &rarr; Reset the panel</b>, which deletes everything first.</p>
      <button class="btn" type="submit" style="width:100%">Install</button>
    </section>
    <div class="row between" id="wiznav" style="margin-top:1rem" hidden>
      <button type="button" class="btn ghost" id="back">Back</button>
      <button type="button" class="btn" id="next">Next</button>
    </div>
  </form>
</div>
${raw(`<script>
(function(){
  var form=document.getElementById('wiz'),steps=[].slice.call(form.querySelectorAll('[data-step]')),i=0;
  var back=document.getElementById('back'),next=document.getElementById('next');
  document.getElementById('wiznav').hidden=false;
  function show(){steps.forEach(function(s,n){s.hidden=n!==i});back.style.visibility=i?'visible':'hidden';next.hidden=i===steps.length-1;
    document.getElementById('stepno').textContent='Step '+(i+1)+' of '+steps.length}
  function valid(){var f=steps[i].querySelectorAll('input');for(var n=0;n<f.length;n++){if(!f[n].reportValidity())return false}
    var p=form.password,p2=form.password2;if(i===0&&p.value!==p2.value){p2.setCustomValidity('Passwords do not match');p2.reportValidity();p2.setCustomValidity('');return false}return true}
  next.onclick=function(){if(valid()){i++;show()}};back.onclick=function(){i--;show()};
  form.slug.oninput=function(){document.getElementById('slugshow').textContent=form.slug.value};
  form.addEventListener('keydown',function(e){if(e.key==='Enter'&&i<steps.length-1){e.preventDefault();next.click()}});
  show();
})();
</script>`)}`;
  return shell('Install', body);
}

install.get('/', async (c) => {
  if (await dbHasUsers(c.env)) {
    await markInstalled(c.env); // heal a missing/lagging KV flag
    return c.redirect('/', 302);
  }
  const host = new URL(c.req.url).host;
  // Start from the domain's own name, so a fresh install is already called
  // something recognisable and keeps following the domain until it is renamed.
  const suggested = siteNameFromHost(host) || 'My Site';
  return c.html(wizard({ username: '', email: '', title: suggested, domain: host, slug: 'admin-panel' }), 200, { 'Cache-Control': 'no-store' });
});

install.post('/', async (c) => {
  if (!sameOrigin(c.req.raw)) return c.text('Bad origin', 403);
  if (await dbHasUsers(c.env)) {
    await markInstalled(c.env);
    return c.notFound();
  }
  const form = await c.req.formData();
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const v: Values = { username: get('username'), email: get('email'), title: get('title'), domain: cleanDomain(get('domain')), slug: get('slug').toLowerCase() };
  const password = String(form.get('password') ?? '');

  const errors: string[] = [];
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(v.username)) errors.push('Username: 3-32 letters, digits, dot, dash or underscore.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errors.push('Enter a valid email address.');
  if (password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password !== String(form.get('password2') ?? '')) errors.push('Passwords do not match.');
  if (!v.title) errors.push('Site title is required.');
  if (!v.domain) errors.push('Enter a valid primary domain, e.g. example.com.');
  if (!validAdminSlug(v.slug)) errors.push('Admin slug: 3-41 lowercase letters, digits or dashes, and not a reserved path.');
  if (errors.length) return c.html(wizard(v, errors), 400);

  const now = new Date().toISOString();
  const host = new URL(c.req.url).host;
  // '' means "follow the domain": the public site derives the title per request,
  // so the same install names itself correctly on a custom domain, on a platform
  // address, or after being deployed again somewhere else.
  const titleStored = v.title === siteNameFromHost(host) ? '' : v.title;
  const shownTitle = displayTitle(titleStored, host);
  const cfg: Config = {
    adminSlug: v.slug,
    secret: randomToken(48),
    cacheV: Date.now(),
    primaryDomain: v.domain,
    domains: [...new Set([v.domain, host])],
  };
  // Order matters: config first (inert without the flag), then one atomic D1
  // batch, then the lock. A failure at any point leaves a retryable state.
  await saveConfig(c.env, cfg);
  await createSchema(c.env);

  const db = c.env.DB;
  // The bundled theme's stylesheet is a served asset like any other (that is what
  // v2 layouts link), so the file store gets it at install time.
  const { putFile } = await import('../lib/files');
  await putFile(c.env, `themes/${defaultTheme.slug}/style.css`,
    new TextEncoder().encode(defaultTheme.css).buffer as ArrayBuffer, 'text/css; charset=utf-8');
  const setting = db.prepare('INSERT OR REPLACE INTO settings (site_id,key,value) VALUES (1,?,?)');
  const homeBody = `<h1>Welcome to ${shownTitle.replace(/[<>&]/g, '')}</h1>\n<p>This is your sample home page. Sign in to the admin panel to edit it, write your first post and upload media.</p>`;
  await db.batch([
    db.prepare("INSERT INTO users (username,email,password_hash,role,created_at) VALUES (?,?,?,'admin',?)").bind(v.username, v.email, await hashPassword(password), now),
    db.prepare('INSERT OR REPLACE INTO sites (id,hostname,name,created_at) VALUES (1,?,?,?)').bind(v.domain, shownTitle, now),
    db.prepare('INSERT OR REPLACE INTO themes (slug,name,version,templates,partials,css,manifest,active,created_at) VALUES (?,?,?,?,?,?,?,1,?)')
      .bind(defaultTheme.slug, defaultTheme.name, defaultTheme.version, JSON.stringify(defaultTheme.templates),
        JSON.stringify(defaultTheme.partials), defaultTheme.css, JSON.stringify(defaultTheme.manifest), now),
    db.prepare('INSERT OR REPLACE INTO theme_assets (theme_slug,path,mime,size,created_at) VALUES (?,?,?,?,?)')
      .bind(defaultTheme.slug, 'style.css', 'text/css; charset=utf-8', defaultTheme.css.length, now),
    db.prepare("INSERT INTO content (site_id,type,title,slug,body,status,author_id,published_at,created_at,updated_at) VALUES (1,'page','Home','home',?,'published',1,?,?,?)").bind(homeBody, now, now, now),
    db.prepare("INSERT INTO menus (id,site_id,name,location) VALUES (1,1,'Primary','primary')"),
    db.prepare("INSERT INTO menu_items (menu_id,label,url,position) VALUES (1,'Home','/',0),(1,'Blog','/blog',1)"),
    setting.bind('site_title', titleStored),
    setting.bind('tagline', ''),
    setting.bind('domains', cfg.domains.join('\n')),
    setting.bind('favicon', ''),
    setting.bind('timezone', 'UTC'),
    setting.bind('permalink_style', 'blog'),
    setting.bind('posts_per_page', '10'),
    setting.bind('schema_version', String(SCHEMA_VERSION)),
    setting.bind('installed_at', now),
    db.prepare("INSERT OR REPLACE INTO settings (site_id,key,value) SELECT 1,'home_page_id',CAST(id AS TEXT) FROM content WHERE site_id=1 AND type='page' AND slug='home'"),
  ]);
  await markInstalled(c.env);

  return c.html(shell('Installed', html`
<div class="auth"><div class="card">
  <h1>All set 🎉</h1>
  <p>Your site is installed and the installer is now disabled.</p>
  <p>Admin panel: <a href="/${v.slug}"><b>/${v.slug}</b></a> — bookmark it, it is not linked from the public site.</p>
  <p class="row"><a class="btn" href="/${v.slug}">Open admin</a> <a class="btn ghost" href="/">View site</a></p>
</div></div>`), 200, { 'Cache-Control': 'no-store' });
});

export default install;
