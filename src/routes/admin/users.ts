import { Hono } from 'hono';
import { audit } from '../../lib/audit';
import { roleSummary } from '../../lib/capabilities';
import type { AppEnv, Ctx } from '../../types';
import { can, hashPassword } from '../../lib/auth';
import { card, emptyState, pageHead, table } from '../../admin/components';
import { icon } from '../../admin/icons';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';

/**
 * Users and roles. Admins manage every account; everyone can edit their own
 * profile (name, email, password) under Profile.
 *
 * Roles: admin (everything), editor (all content, media, menus, comments),
 * author (own posts and media only).
 */
const users = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'manage_users')) return errorPage(c, 403, 'Only admins can manage users.');
  await next();
};
users.use('/users', guard);
users.use('/users/*', guard);

const ROLES = ['admin', 'editor', 'author'] as const;
type Role = (typeof ROLES)[number];
type UserRow = { id: number; username: string; email: string; role: Role; created_at: string };
type Row = UserRow & { posts: number };

/**
 * What each role can do is derived from the capability map (lib/capabilities.ts)
 * rather than restated here, so the description in the dropdown cannot drift
 * from what the routes actually allow.
 */
const roleHelp = (role: Role): string => roleSummary(role);

function userForm(c: Ctx, row: UserRow | null, error = ''): Promise<Response> {
  const base = c.var.base;
  const isSelf = row?.id === c.var.user.id;
  return layout(c, row ? `Edit ${row.username}` : 'Add user', html`
<div class="row between" style="margin-bottom:1rem">
  <h1 style="margin:0">${row ? 'Edit user' : 'Add user'}</h1>
  <a href="${base}/users">&larr; All users</a>
</div>
${error ? html`<div class="flash err" role="alert">${error}</div>` : ''}
<form method="post" action="${base}/users/save" class="card">
  ${csrfField(c)}
  <input type="hidden" name="id" value="${row?.id ?? ''}">
  <label for="username" style="margin-top:0">Username</label>
  <input type="text" id="username" name="username" value="${row?.username ?? ''}" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_.\\-]+" autocapitalize="none">
  <p class="hint">3–32 letters, digits, dots, dashes or underscores. Used to sign in.</p>
  <label for="email">Email</label>
  <input type="email" id="email" name="email" value="${row?.email ?? ''}" required maxlength="160">
  <label for="role">Role</label>
  <select id="role" name="role">
    ${ROLES.map((r) => html`<option value="${r}"${row?.role === r ? raw(' selected') : ''}>${r[0].toUpperCase() + r.slice(1)} — ${roleHelp(r)}</option>`)}
  </select>
  ${isSelf ? html`<p class="hint">You cannot demote or delete the account you are signed in with.</p>` : ''}
  <label for="password">${row ? 'New password' : 'Password'}</label>
  <input type="password" id="password" name="password" minlength="8" autocomplete="new-password"${row ? '' : raw(' required')}>
  <p class="hint">${row ? 'Leave empty to keep the current password.' : 'At least 8 characters.'}</p>
  <p style="margin:1.1rem 0 0"><button class="btn" type="submit">${row ? 'Save user' : 'Create user'}</button></p>
</form>
${row && !isSelf ? html`<form method="post" action="${base}/users/${row.id}/delete" data-confirm="${`Delete ${row.username}? Their posts stay and are assigned to you.`}">
  ${csrfField(c)}<button class="btn danger" type="submit">Delete user</button>
</form>` : ''}
${raw(`<script>document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm(f.getAttribute('data-confirm')))e.preventDefault()})});</script>`)}`, '/users');
}

users.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.email, u.role, u.created_at,
            (SELECT COUNT(*) FROM content WHERE author_id=u.id) AS posts
     FROM users u ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.username`,
  ).all<Row>();
  const base = c.var.base;
  return layout(c, 'Users', html`
${pageHead({
    title: 'Users',
    sub: 'Who can sign in, and what each role is allowed to do.',
    actions: html`<a class="btn" href="${base}/users/new">${icon('plus', { cls: 'ico--sm' })}Add user</a>`,
  })}
${card({
    flush: true,
    body: results.length
      ? table({
        columns: [
          { label: 'User' },
          { label: 'Role' },
          { label: 'Posts', align: 'center' },
          { label: 'Added' },
          { label: '', cls: 'actions' },
        ],
        rows: results.map((u) => [
          html`<a href="${base}/users/${u.id}"><b>${u.username}</b></a><br><small class="muted">${u.email}</small>`,
          html`<span class="pill ${u.role === 'admin' ? 'on' : 'off'}">${u.role}</span>`,
          u.posts,
          html`<small class="muted">${u.created_at.slice(0, 10)}</small>`,
          u.id === c.var.user.id
            ? html`<span class="muted" style="font-size:var(--text-xs)">you</span>`
            : html`<a class="btn ghost small" href="${base}/users/${u.id}">Edit</a>`,
        ]),
      })
      : emptyState({ title: 'No users yet', body: 'That should not happen: at least one admin always exists.', iconName: 'users' }),
  })}
${card({
    title: 'Roles',
    body: html`<ul class="list">
    ${ROLES.map((r) => html`<li><div class="t"><b>${r[0].toUpperCase() + r.slice(1)}</b><small>${roleHelp(r)}</small></div></li>`)}
  </ul>
  <p class="hint" style="margin-bottom:0">You can change your own email and password under <a href="${base}/profile">Profile</a>.</p>`,
  })}`, '/users');
});

users.get('/users/new', (c) => userForm(c, null));

users.get('/users/:id{[0-9]+}', async (c) => {
  const row = await c.env.DB.prepare('SELECT id, username, email, role, created_at FROM users WHERE id=?')
    .bind(Number(c.req.param('id'))).first<UserRow>();
  if (!row) return errorPage(c, 404, 'User not found.');
  return userForm(c, row);
});

users.post('/users/save', async (c) => {
  const f = c.var.form;
  const id = Number(f.get('id')) || 0;
  const username = String(f.get('username') ?? '').trim();
  const email = String(f.get('email') ?? '').trim();
  const role = String(f.get('role') ?? 'author');
  const password = String(f.get('password') ?? '');
  const existing = id
    ? await c.env.DB.prepare('SELECT id, username, email, role, created_at FROM users WHERE id=?').bind(id).first<UserRow>()
    : null;
  if (id && !existing) return errorPage(c, 404, 'User not found.');
  const fail = (msg: string) => userForm(c, id ? existing! : null, msg);

  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return fail('Username: 3–32 letters, digits, dots, dashes or underscores.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email address.');
  if (!ROLES.includes(role as Role)) return fail('Choose a valid role.');
  if (!id && password.length < 8) return fail('Password must be at least 8 characters.');
  if (id && password && password.length < 8) return fail('The new password must be at least 8 characters.');

  if (username.toLowerCase() !== (existing?.username ?? '').toLowerCase() &&
      (await c.env.DB.prepare('SELECT 1 AS x FROM users WHERE username=? AND id<>?').bind(username, id).first())) {
    return fail('That username is already taken.');
  }
  if (email.toLowerCase() !== (existing?.email ?? '').toLowerCase() &&
      (await c.env.DB.prepare('SELECT 1 AS x FROM users WHERE email=? AND id<>?').bind(email, id).first())) {
    return fail('That email is already used by another account.');
  }

  // Never lock the site out: the account you are using and the last admin stay admin.
  if (existing && existing.id === c.var.user.id && role !== 'admin') return fail('You cannot change your own role.');
  if (existing && existing.role === 'admin' && role !== 'admin') {
    const admins = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first<{ n: number }>();
    if (Number(admins?.n || 0) <= 1) return fail('There must always be at least one admin.');
  }

  if (existing) {
    const hash = password ? await hashPassword(password) : null;
    if (hash) {
      await c.env.DB.prepare('UPDATE users SET username=?, email=?, role=?, password_hash=? WHERE id=?')
        .bind(username, email, role, hash, id).run();
    } else {
      await c.env.DB.prepare('UPDATE users SET username=?, email=?, role=? WHERE id=?')
        .bind(username, email, role, id).run();
    }
    await audit(c, 'updated', 'user', `Updated user “${username}” (${role})`, id);
    return go(c, '/users', { ok: `${username} saved.` });
  }

  const created = await c.env.DB.prepare('INSERT INTO users (username,email,password_hash,role,created_at) VALUES (?,?,?,?,?)')
    .bind(username, email, await hashPassword(password), role, new Date().toISOString()).run();
  await audit(c, 'created', 'user', `Created user “${username}” (${role})`, Number(created.meta.last_row_id));
  return go(c, '/users', { ok: `${username} can now sign in.` });
});

users.post('/users/:id{[0-9]+}/delete', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT id, username, role FROM users WHERE id=?').bind(id)
    .first<{ id: number; username: string; role: string }>();
  if (!row) return errorPage(c, 404, 'User not found.');
  if (id === c.var.user.id) return go(c, '/users', { err: 'You cannot delete the account you are signed in with.' });
  if (row.role === 'admin') {
    const admins = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first<{ n: number }>();
    if (Number(admins?.n || 0) <= 1) return go(c, '/users', { err: 'There must always be at least one admin.' });
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE content SET author_id=? WHERE author_id=?').bind(c.var.user.id, id),
    c.env.DB.prepare('UPDATE comments SET user_id=NULL WHERE user_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(id),
  ]);
  await audit(c, 'deleted', 'user', `Deleted user “${row.username}” (${row.role})`, id);
  return go(c, '/users', { ok: `${row.username} deleted. Their posts now belong to you.` });
});

export default users;
