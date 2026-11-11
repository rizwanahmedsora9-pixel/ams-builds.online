import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { can, csrfToken, endSession, hashPassword, sessionUser, startSession, verifyPassword } from '../../lib/auth';
import { cfgFor, getConfig, getSettings } from '../../lib/config';
import { clientIp, rateCount, rateHit, rateReset, sameOrigin, timingSafeEqual } from '../../lib/security';
import { csrfField, errorPage, flash, go, html, layout, shell } from '../../lib/ui';
import content from './content';
import media from './media';
import settings from './settings';

/**
 * Admin panel. Mounted by the root app under "/{admin-slug}" with that prefix
 * already stripped, so routes here are written relative ("/pages", "/media").
 */
const admin = new Hono<AppEnv>();

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW = 15 * 60;

// 1. config, security headers, CSRF for every state-changing request
admin.use('*', async (c, next) => {
  const cfg = cfgFor.get(c.req.raw) ?? (await getConfig(c.env));
  c.set('cfg', cfg);
  c.set('base', '/' + cfg.adminSlug);
  c.header('Cache-Control', 'no-store');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.set('csrf', await csrfToken(c, cfg));

  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    if (!sameOrigin(c.req.raw)) return errorPage(c, 403, 'Cross-site request blocked.');
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return errorPage(c, 400, 'Malformed form submission.');
    }
    if (!timingSafeEqual(String(form.get('_csrf') ?? ''), c.var.csrf)) {
      return errorPage(c, 403, 'Your form expired. Go back, reload the page and try again.');
    }
    c.set('form', form);
  }
  await next();
});

/* ------------------------------------------------------------------- login */
admin.get('/login', async (c) => {
  if (await sessionUser(c, c.var.cfg)) return c.redirect(c.var.base, 302);
  return c.html(shell('Log in', html`
<div class="auth">
  <h1>Log in</h1>
  ${flash(c)}
  <form method="post" action="${c.var.base}/login" class="card">
    ${csrfField(c)}
    <label for="login">Username or email</label>
    <input type="text" id="login" name="login" required autocapitalize="none" autocomplete="username" autofocus>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required autocomplete="current-password">
    <p style="margin:1.1rem 0 0"><button class="btn" type="submit" style="width:100%">Log in</button></p>
  </form>
</div>`));
});

admin.post('/login', async (c) => {
  const rlKey = 'login:' + clientIp(c.req.raw);
  if ((await rateCount(c.env, rlKey)) >= LOGIN_MAX_ATTEMPTS) {
    return c.html(shell('Log in', html`<div class="auth"><div class="flash err">Too many failed attempts. Try again in 15 minutes.</div></div>`), 429);
  }
  const login = String(c.var.form.get('login') ?? '').trim();
  const password = String(c.var.form.get('password') ?? '');
  const row = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE username=? OR email=? LIMIT 1')
    .bind(login, login).first<{ id: number; password_hash: string }>();
  // Always run PBKDF2 so response time does not reveal whether the account exists.
  const ok = row ? await verifyPassword(password, row.password_hash) : (await hashPassword(password), false);
  if (!row || !ok) {
    await rateHit(c.env, rlKey, LOGIN_WINDOW);
    return go(c, '/login', { err: 'Wrong username or password.' });
  }
  await rateReset(c.env, rlKey);
  await startSession(c, c.var.cfg, row.id, row.password_hash);
  return c.redirect(c.var.base, 303);
});

// 2. everything below requires a session
admin.use('*', async (c, next) => {
  const user = await sessionUser(c, c.var.cfg);
  if (!user) return c.redirect(c.var.base + '/login', 302);
  c.set('user', user);
  await next();
});

admin.post('/logout', (c) => {
  endSession(c);
  return go(c, '/login', { ok: 'You are logged out.' });
});

/* --------------------------------------------------------------- dashboard */
admin.get('/', async (c) => {
  const [counts, recent, settingsMap] = await Promise.all([
    c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM content WHERE site_id=1 AND type='page') AS pages,
              (SELECT COUNT(*) FROM content WHERE site_id=1 AND type='post') AS posts,
              (SELECT COUNT(*) FROM media WHERE site_id=1) AS media`,
    ).first<{ pages: number; posts: number; media: number }>(),
    c.env.DB.prepare('SELECT id, type, title, status, updated_at FROM content WHERE site_id=1 ORDER BY updated_at DESC LIMIT 6')
      .all<{ id: number; type: string; title: string; status: string; updated_at: string }>(),
    getSettings(c.env),
  ]);
  const base = c.var.base;
  return layout(c, settingsMap.site_title || 'Dashboard', html`
<h1>Dashboard</h1>
<div class="stats">
  <a class="stat" href="${base}/pages"><b>${counts?.pages ?? 0}</b><span>Pages</span></a>
  <a class="stat" href="${base}/posts"><b>${counts?.posts ?? 0}</b><span>Posts</span></a>
  <a class="stat" href="${base}/media"><b>${counts?.media ?? 0}</b><span>Media</span></a>
</div>
<div class="row" style="margin-bottom:1rem">
  <a class="btn" href="${base}/posts/new">New post</a>
  ${can(c.var.user, 'editor') ? html`<a class="btn ghost" href="${base}/pages/new">New page</a>` : ''}
  <a class="btn ghost" href="${base}/media">Upload media</a>
</div>
<div class="card">
  <h2>Recently edited</h2>
  <ul class="list">
    ${recent.results.map((r) => html`<li><div class="t"><a href="${base}/${r.type}s/${r.id}">${r.title}</a><small>${r.type} · ${r.updated_at.slice(0, 10)}</small></div><span class="badge ${r.status}">${r.status}</span></li>`)}
    ${recent.results.length ? '' : html`<li class="muted">Nothing yet.</li>`}
  </ul>
</div>`, '');
});

/* ----------------------------------------------------------------- profile */
admin.get('/profile', (c) => layout(c, 'Profile', html`
<h1>Profile</h1>
<form method="post" action="${c.var.base}/profile" class="card">
  ${csrfField(c)}
  <p class="muted" style="margin-top:0">Signed in as <b>${c.var.user.username}</b> (${c.var.user.role})</p>
  <label for="email">Email</label>
  <input type="email" id="email" name="email" value="${c.var.user.email}" required>
  <label for="new_password">New password</label>
  <input type="password" id="new_password" name="new_password" minlength="8" autocomplete="new-password">
  <p class="hint">Leave empty to keep your current password. Changing it signs out your other devices.</p>
  <label for="current_password">Current password (required to save)</label>
  <input type="password" id="current_password" name="current_password" required autocomplete="current-password">
  <p style="margin:1.1rem 0 0"><button class="btn" type="submit">Save profile</button></p>
</form>`, '/profile'));

admin.post('/profile', async (c) => {
  const f = c.var.form;
  const email = String(f.get('email') ?? '').trim();
  const next = String(f.get('new_password') ?? '');
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(c.var.user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(String(f.get('current_password') ?? ''), row.password_hash))) {
    return go(c, '/profile', { err: 'Current password is incorrect.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return go(c, '/profile', { err: 'Enter a valid email address.' });
  if (next && next.length < 8) return go(c, '/profile', { err: 'New password must be at least 8 characters.' });
  const taken = await c.env.DB.prepare('SELECT 1 AS x FROM users WHERE email=? AND id<>?').bind(email, c.var.user.id).first();
  if (taken) return go(c, '/profile', { err: 'That email is already used by another account.' });
  const hash = next ? await hashPassword(next) : row.password_hash;
  await c.env.DB.prepare('UPDATE users SET email=?, password_hash=? WHERE id=?').bind(email, hash, c.var.user.id).run();
  await startSession(c, c.var.cfg, c.var.user.id, hash);
  return go(c, '/profile', { ok: 'Profile saved.' });
});

admin.route('/', content);
admin.route('/', media);
admin.route('/', settings);

admin.notFound((c) => errorPage(c, 404, 'That admin page does not exist.'));

export default admin;
