import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { csrfToken, endSession, hashPassword, sessionUser, startSession, verifyPassword } from '../../lib/auth';
import { can } from '../../lib/capabilities';
import { cfgFor, getConfig, getSettings } from '../../lib/config';
import { clientIp, rateCount, rateHit, rateReset, sameOrigin, timingSafeEqual } from '../../lib/security';
import { csrfField, errorPage, flash, go, guardPage, html, layout, shell } from '../../lib/ui';
import { SCHEMA_VERSION, installedSchemaVersion, pendingMigrations } from '../../db/migrations';
import { greeting, needsAttention, type AttentionItem } from '../../admin/attention';
import { APP_VERSION } from '../../lib/version';
import { readPrefs } from '../../lib/prefs';
import { icon } from '../../admin/icons';
import { card, emptyState, notice } from '../../admin/components';
import content from './content';
import media from './media';
import settings from './settings';
import landing from './landing';
import menus from './menus';
import themes from './themes';
import comments from './comments';
import users from './users';
import plugins from './plugins';
import tools from './tools';
import system from './system';
import updates from './updates';
import appearance from './appearance';
import terms from './terms';
import preferences from './preferences';
import assets from './assets';
import shellRoutes from './shell';
import { defaultTheme } from '../../themes/default';

const BUNDLED_THEME_NAME = defaultTheme.name;

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
</div>`, { base: c.var.base, prefs: readPrefs(c) }));
});

admin.post('/login', async (c) => {
  const rlKey = 'login:' + clientIp(c.req.raw);
  if ((await rateCount(c.env, rlKey)) >= LOGIN_MAX_ATTEMPTS) {
    return c.html(shell('Log in', html`<div class="auth"><div class="flash err">${icon('alert')}<span>Too many failed attempts. Try again in 15 minutes.</span></div></div>`, { base: c.var.base, prefs: readPrefs(c) }), 429);
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

// 1b. Panel stylesheets are public within the admin prefix: they contain no
//     data, and being cacheable is the point. Mounted before the session guard.
admin.route('/', assets);

// 2. everything below requires a session
admin.use('*', async (c, next) => {
  const user = await sessionUser(c, c.var.cfg);
  if (!user) return c.redirect(c.var.base + '/login', 302);
  c.set('user', user);
  await next();
});

// 3. error boundary: a bug in one screen renders a styled error page naming the
//    route instead of the runtime's bare 500. Redirects and typed responses pass
//    through untouched; only escapes from a handler are caught.
admin.use('*', async (c, next) => {
  c.res = await guardPage(c, async () => {
    await next();
    return c.res;
  });
});

admin.post('/logout', (c) => {
  endSession(c);
  return go(c, '/login', { ok: 'You are logged out.' });
});

/* --------------------------------------------------------------- dashboard */
const EMPTY_STATS = { pages: 0, posts: 0, media: 0, users: 0, pending: 0, approved: 0 };
type Stats = typeof EMPTY_STATS;

async function dashboardStats(c: Ctx): Promise<Stats> {
  try {
    const row = await c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM content WHERE site_id=1 AND type='page') AS pages,
              (SELECT COUNT(*) FROM content WHERE site_id=1 AND type='post') AS posts,
              (SELECT COUNT(*) FROM media WHERE site_id=1) AS media,
              (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM comments WHERE site_id=1 AND status='pending') AS pending,
              (SELECT COUNT(*) FROM comments WHERE site_id=1 AND status='approved') AS approved`,
    ).first<Stats>();
    return row ?? EMPTY_STATS;
  } catch {
    // A database that has not run the comments migration yet.
    try {
      const row = await c.env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM content WHERE site_id=1 AND type='page') AS pages,
                (SELECT COUNT(*) FROM content WHERE site_id=1 AND type='post') AS posts,
                (SELECT COUNT(*) FROM media WHERE site_id=1) AS media,
                (SELECT COUNT(*) FROM users) AS users`,
      ).first<Stats>();
      return { ...EMPTY_STATS, ...row };
    } catch {
      return EMPTY_STATS;
    }
  }
}

admin.get('/', async (c) => {
  const base = c.var.base;
  const user = c.var.user;
  const [counts, recent, recentComments, settingsMap, theme, schema, attention] = await Promise.all([
    dashboardStats(c),
    c.env.DB.prepare(
      `SELECT c.id, c.type, c.title, c.status, c.updated_at, u.username AS author
       FROM content c LEFT JOIN users u ON u.id=c.author_id WHERE c.site_id=1
       ORDER BY c.updated_at DESC, c.id DESC LIMIT 6`,
    ).all<{ id: number; type: string; title: string; status: string; updated_at: string; author: string | null }>(),
    can(user, 'moderate_comments')
      ? c.env.DB.prepare(
        `SELECT cm.id, cm.author_name, cm.body, cm.status, cm.created_at, c.title AS post
         FROM comments cm JOIN content c ON c.id=cm.content_id WHERE cm.site_id=1
         ORDER BY cm.created_at DESC, cm.id DESC LIMIT 4`,
      ).all<{ id: number; author_name: string; body: string; status: string; created_at: string; post: string }>()
        .catch(() => ({ results: [] as { id: number; author_name: string; body: string; status: string; created_at: string; post: string }[] }))
      : Promise.resolve({ results: [] as { id: number; author_name: string; body: string; status: string; created_at: string; post: string }[] }),
    getSettings(c.env),
    c.env.DB.prepare('SELECT name, version FROM themes WHERE active=1 LIMIT 1').first<{ name: string; version: string }>().catch(() => null),
    installedSchemaVersion(c.env).catch(() => 1),
    needsAttention(c, base).catch(() => ({ items: [] as AttentionItem[], checked: 0 })),
  ]);
  const pendingUpdates = pendingMigrations(schema).length;
  const moderated = settingsMap.comments_enabled !== '0' && settingsMap.comments_require_approval !== '0';
  const urgent = attention.items.filter((item) => item.tone === 'danger');
  const siteName = settingsMap.site_title || 'your site';

  const stats = [
    can(user, 'manage_pages') ? { href: `${base}/pages`, value: counts.pages, label: 'Pages', icon: 'file' } : null,
    { href: `${base}/posts`, value: counts.posts, label: 'Posts', icon: 'edit' },
    { href: `${base}/media`, value: counts.media, label: 'Media', icon: 'image' },
  ].filter(Boolean) as { href: string; value: number; label: string; icon: string }[];

  return layout(c, 'Dashboard', html`
<section class="dash" aria-labelledby="dash-title">
  <header class="dash__head">
    <div>
      <p class="dash__hi">${greeting(user.username)}</p>
      <h1 id="dash-title">${siteName}</h1>
      <p class="dash__sub">${attention.items.length
        ? `${attention.items.length} thing${attention.items.length === 1 ? '' : 's'} could use you today.`
        : recent.results.length ? 'Nothing is waiting on you. Pick up where you left off.' : 'Start by writing your first post.'}</p>
    </div>
    <div class="row">
      <a class="btn" href="${base}/posts/new">${icon('plus', { cls: 'ico--sm' })}New post</a>
      ${can(user, 'manage_pages') ? html`<a class="btn ghost" href="${base}/pages/new">New page</a>` : ''}
      <a class="btn ghost" href="${base}/media#upload">Upload media</a>
    </div>
  </header>

  ${urgent.length ? notice(html`${urgent.map((item) => html`<a href="${item.href}">${item.title}</a>`).reduce((a, b) => html`${a} · ${b}`)}`, { tone: 'danger', title: 'Needs attention now:' }) : ''}

  <ul class="stats" aria-label="Site totals">
    ${stats.map((stat) => html`<li><a class="stat" href="${stat.href}">
      <span class="stat__ico">${icon(stat.icon)}</span>
      <b>${stat.value}</b><span>${stat.label}</span>
    </a></li>`)}
  </ul>

  <div class="dash__cols">
    <div class="dash__main">
      ${card({
        title: 'Needs attention',
        actions: attention.items.length ? html`<span class="card__count">${attention.items.length}</span>` : '',
        flush: true,
        body: attention.items.length
          ? html`<ul class="attention" data-attention>
            ${attention.items.map((item) => html`<li class="attention__item attention__item--${item.tone}" data-attention-item="${item.key}">
              <span class="attention__ico" aria-hidden="true">${icon(item.tone === 'info' ? 'info' : 'alert', { cls: 'ico--sm' })}</span>
              <div class="attention__body">
                <strong>${item.title}</strong>
                <p>${item.body}</p>
              </div>
              <a class="btn ghost small" href="${item.href}">${item.cta}${icon('chevron-right', { cls: 'ico--sm' })}</a>
            </li>`)}
          </ul>`
          : emptyState({
            title: 'All clear',
            body: `Every check passed${attention.checked ? ` (${attention.checked} of them)` : ''}. Nothing is broken, overdue or waiting on you.`,
            iconName: 'check',
          }),
      })}

      ${card({
        title: 'Recently edited',
        actions: html`<a class="btn ghost small" href="${base}/posts">All posts</a>`,
        flush: true,
        body: recent.results.length
          ? html`<ul class="list list--rows">
            ${recent.results.map((r) => html`<li>
              <div class="t"><a href="${base}/${r.type}s/${r.id}">${r.title || '(untitled)'}</a>
                <small>${r.type} · ${r.author ? r.author + ' · ' : ''}<time datetime="${r.updated_at}">${r.updated_at.slice(0, 10)}</time></small></div>
              <span class="badge ${r.status}">${r.status}</span>
            </li>`)}
          </ul>`
          : emptyState({ title: 'Nothing written yet', body: 'Your first post takes about five minutes.', action: html`<a class="btn" href="${base}/posts/new">Write a post</a>` }),
      })}
    </div>

    <aside class="dash__side" aria-label="Site status">
      ${card({
        title: 'At a glance',
        body: html`<dl class="kv kv--tight">
          <dt>Version</dt><dd>${APP_VERSION}</dd>
          <dt>Schema</dt><dd>${schema}${pendingUpdates ? html` · <a href="${base}/updates">${pendingUpdates} update${pendingUpdates === 1 ? '' : 's'} ready</a>` : ' · up to date'}</dd>
          <dt>Theme</dt><dd>${theme ? `${theme.name} v${theme.version}` : BUNDLED_THEME_NAME}</dd>
          <dt>Comments</dt><dd>${counts.pending} pending · ${counts.approved} approved</dd>
          <dt>Moderation</dt><dd>${moderated ? 'New comments wait for you' : 'Comments appear immediately'}</dd>
        </dl>`,
      })}
      ${can(user, 'moderate_comments') ? card({
        title: 'Latest comments',
        actions: html`<a class="btn ghost small" href="${base}/comments">All</a>`,
        flush: true,
        body: recentComments.results.length
          ? html`<ul class="list list--rows">
            ${recentComments.results.map((cm) => html`<li class="wrap">
              <div class="t"><b>${cm.author_name}</b> <small>on ${cm.post}</small>
                <div class="comment-body-preview">${cm.body.slice(0, 120)}</div></div>
              <span class="badge ${cm.status}">${cm.status}</span>
            </li>`)}
          </ul>`
          : html`<div class="card__pad"><p class="muted">No comments yet. They will show up here for you to approve.</p></div>`,
      }) : ''}
    </aside>
  </div>
</section>`, '');
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
admin.route('/', landing);
admin.route('/', menus);
admin.route('/', themes);
admin.route('/', comments);
admin.route('/', users);
admin.route('/', plugins);
admin.route('/', tools);
admin.route('/', system);
admin.route('/', updates);
admin.route('/', appearance);
admin.route('/', terms);
admin.route('/', preferences);
admin.route('/', shellRoutes);

admin.notFound((c) => errorPage(c, 404, 'That admin page does not exist.'));

export default admin;
