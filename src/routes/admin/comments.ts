import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { bumpCache } from '../../lib/config';
import { STATUSES, commentCounts, type CommentRow, type CommentStatus } from '../../lib/comments';
import { esc } from '../../lib/security';
import { pageHead, tabs } from '../../admin/components';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';

/**
 * Comment moderation. Editors and admins see every comment, filter by status,
 * approve, unapprove, mark as spam, move to trash, reply as themselves or
 * delete permanently. Comments arrive from the public form on each post.
 */
const comments = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'editor')) return errorPage(c, 403, 'Your role cannot moderate comments.');
  await next();
};
comments.use('/comments', guard);
comments.use('/comments/*', guard);

type Row = CommentRow & { content_title: string; content_type: string; content_slug: string };

const backTo = (c: Ctx, status: string, msg: { ok?: string; err?: string }): Response => {
  const q = new URLSearchParams();
  if (status && status !== 'all') q.set('status', status);
  if (msg.ok) q.set('ok', msg.ok);
  if (msg.err) q.set('err', msg.err);
  return c.redirect(c.var.base + '/comments' + (q.size ? '?' + q.toString() : ''), 303);
};

const filterStatus = (c: Ctx): string => {
  const s = c.req.query('status') || 'all';
  return s === 'all' || STATUSES.includes(s as CommentStatus) ? s : 'all';
};

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

comments.get('/comments', async (c) => {
  const status = filterStatus(c);
  const per = 30;
  const p = Math.max(1, Number(c.req.query('p')) || 1);
  const where = status === 'all' ? '' : ' AND cm.status=?';
  const args: (string | number)[] = status === 'all' ? [] : [status];
  const [counts, rows] = await Promise.all([
    commentCounts(c.env),
    c.env.DB.prepare(
      `SELECT cm.id, cm.content_id, cm.parent_id, cm.author_name, cm.author_email, cm.body, cm.status, cm.user_id, cm.created_at,
              c.title AS content_title, c.type AS content_type, c.slug AS content_slug
       FROM comments cm JOIN content c ON c.id=cm.content_id
       WHERE cm.site_id=1${where} ORDER BY cm.created_at DESC, cm.id DESC LIMIT ? OFFSET ?`,
    ).bind(...args, per + 1, (p - 1) * per).all<Row>(),
  ]);
  const list = rows.results.slice(0, per);
  const base = c.var.base;
  const filters: [string, string][] = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['spam', 'Spam'], ['trash', 'Trash']];
  const statusAction = (row: Row, next: CommentStatus, text: string, cls = 'ghost') => html`
    <form method="post" action="${base}/comments/${row.id}/status" class="inline">
      ${csrfField(c)}<input type="hidden" name="status" value="${next}"><input type="hidden" name="from" value="${status}">
      <button class="btn ${cls} small" type="submit">${text}</button>
    </form>`;

  return layout(c, 'Comments', html`
${pageHead({
    title: 'Comments',
    sub: `${counts.pending} waiting for review.`,
  })}
${tabs(filters.map(([key, text]) => ({
    label: html`${text} <span class="muted">${counts[key as keyof typeof counts]}</span>`,
    href: `${base}/comments${key === 'all' ? '' : '?status=' + key}`,
    current: status === key,
  })), { label: 'Comment status' })}
<div class="card">
  ${list.length ? html`<ul class="list">
    ${list.map((row) => html`<li class="wrap" id="comment-${row.id}">
      <div class="t">
        <div><b>${row.author_name}</b> <span class="who">on</span>
          <a href="${base}/${row.content_type === 'post' ? 'posts' : 'pages'}/${row.content_id}">${row.content_title}</a>
          ${row.parent_id ? html` <span class="who">· reply</span>` : ''}
          ${row.user_id ? raw('<span class="pill on">staff</span>') : ''}
        </div>
        <div class="comment-body-preview">${row.body.slice(0, 400)}</div>
        <small class="who">${row.author_email} · ${esc(row.created_at.slice(0, 16).replace('T', ' '))} UTC</small>
      </div>
      <span class="badge ${row.status}">${row.status}</span>
      <div class="row" style="gap:.3rem">
        ${row.status !== 'approved' ? statusAction(row, 'approved', 'Approve') : statusAction(row, 'pending', 'Unapprove')}
        ${row.status !== 'spam' ? statusAction(row, 'spam', 'Spam') : ''}
        ${row.status !== 'trash' ? statusAction(row, 'trash', 'Trash') : ''}
        <form method="post" action="${base}/comments/${row.id}/delete" class="inline" data-confirm>
          ${csrfField(c)}<button class="btn danger small" type="submit">Delete</button>
        </form>
      </div>
      <details style="width:100%">
        <summary class="muted" style="cursor:pointer;font-size:.85rem">Reply as ${c.var.user.username}</summary>
        <form method="post" action="${base}/comments/${row.id}/reply" style="margin-top:.5rem">
          ${csrfField(c)}<input type="hidden" name="from" value="${status}">
          <label for="reply-${row.id}" class="hint" style="margin:0 0 .3rem">Your reply</label>
          <textarea id="reply-${row.id}" name="body" maxlength="4000" required style="min-height:5rem"></textarea>
          <p style="margin:.5rem 0 0"><button class="btn small" type="submit">Post reply</button></p>
        </form>
      </details>
    </li>`)}
  </ul>` : html`<p class="muted" style="margin:0">No ${status === 'all' ? '' : status + ' '}comments yet.</p>`}
</div>
<div class="row between">
  ${p > 1 ? html`<a class="btn ghost small" href="${base}/comments?status=${status}&amp;p=${p - 1}">&larr; Newer</a>` : html`<span></span>`}
  ${rows.results.length > per ? html`<a class="btn ghost small" href="${base}/comments?status=${status}&amp;p=${p + 1}">Older &rarr;</a>` : ''}
</div>
<p class="hint">New comments wait here until you approve them, unless moderation is off in <a href="${base}/settings#discussion">Settings → Discussion</a>.</p>
${raw(`<script>document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm('Delete this comment permanently?'))e.preventDefault()})});</script>`)}`, '/comments');
});

comments.post('/comments/:id{[0-9]+}/status', async (c) => {
  const id = Number(c.req.param('id'));
  const next = String(c.var.form.get('status') ?? '');
  const from = String(c.var.form.get('from') ?? 'all');
  if (!STATUSES.includes(next as CommentStatus)) return go(c, '/comments', { err: 'Unknown comment status.' });
  const row = await c.env.DB.prepare('SELECT id, content_id, status FROM comments WHERE id=? AND site_id=1').bind(id)
    .first<{ id: number; content_id: number; status: string }>();
  if (!row) return errorPage(c, 404, 'Comment not found.');
  await c.env.DB.prepare('UPDATE comments SET status=?, updated_at=? WHERE id=?')
    .bind(next, new Date().toISOString(), id).run();
  // Approved comments are part of the public page.
  if (row.status === 'approved' || next === 'approved') await bumpCache(c.env, c.var.cfg);
  return backTo(c, from, { ok: `Comment ${label(next)}.` });
});

comments.post('/comments/:id{[0-9]+}/reply', async (c) => {
  const id = Number(c.req.param('id'));
  const from = String(c.var.form.get('from') ?? 'all');
  const body = String(c.var.form.get('body') ?? '').trim().slice(0, 4000);
  if (body.length < 2) return backTo(c, from, { err: 'Write a reply first.' });
  const parent = await c.env.DB.prepare('SELECT id, content_id FROM comments WHERE id=? AND site_id=1').bind(id)
    .first<{ id: number; content_id: number }>();
  if (!parent) return errorPage(c, 404, 'Comment not found.');
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'INSERT INTO comments (site_id,content_id,parent_id,author_name,author_email,body,status,user_id,created_at,updated_at) VALUES (1,?,?,?,?,?,?,?,?,?)',
  ).bind(parent.content_id, parent.id, c.var.user.username, c.var.user.email, body, 'approved', c.var.user.id, now, now).run();
  await bumpCache(c.env, c.var.cfg);
  return backTo(c, from, { ok: 'Reply posted.' });
});

comments.post('/comments/:id{[0-9]+}/delete', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT status FROM comments WHERE id=? AND site_id=1').bind(id).first<{ status: string }>();
  if (!row) return errorPage(c, 404, 'Comment not found.');
  await c.env.DB.prepare('DELETE FROM comments WHERE id=?').bind(id).run();
  if (row.status === 'approved') await bumpCache(c.env, c.var.cfg);
  return go(c, '/comments', { ok: 'Comment deleted.' });
});

export default comments;
