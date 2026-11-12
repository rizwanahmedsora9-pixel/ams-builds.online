import type { Env } from '../types';
import type { Settings } from './config';
import { hmac } from './auth';
import { esc } from './security';
import { formatDate } from './time';

/**
 * Comments: public form + moderation. Everything a visitor writes is stored as
 * plain text and escaped when it is rendered, so no sanitizer is needed here.
 */

export type CommentStatus = 'pending' | 'approved' | 'spam' | 'trash';

export type CommentRow = {
  id: number;
  content_id: number;
  parent_id: number | null;
  author_name: string;
  author_email: string;
  author_url: string;
  body: string;
  status: CommentStatus;
  user_id: number | null;
  ip?: string;
  user_agent?: string;
  created_at: string;
  updated_at?: string;
};

export type CommentCounts = Record<CommentStatus, number> & { all: number };

export const STATUSES: CommentStatus[] = ['pending', 'approved', 'spam', 'trash'];

/** Unset means "on", so sites installed before comments existed get them too. */
export const commentsEnabled = (s: Settings): boolean => s.comments_enabled !== '0';
export const commentsModerated = (s: Settings): boolean => s.comments_require_approval !== '0';

export const emptyCounts = (): CommentCounts => ({ pending: 0, approved: 0, spam: 0, trash: 0, all: 0 });

export async function commentCounts(env: Env): Promise<CommentCounts> {
  const counts = emptyCounts();
  try {
    const { results } = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM comments WHERE site_id=1 GROUP BY status')
      .all<{ status: CommentStatus; n: number }>();
    for (const r of results) {
      if (r.status in counts) counts[r.status] = Number(r.n);
      counts.all += Number(r.n);
    }
  } catch {
    /* table not created yet (site not upgraded) */
  }
  return counts;
}

export async function pendingComments(env: Env): Promise<number> {
  return (await commentCounts(env)).pending;
}

export async function approvedComments(env: Env, contentId: number): Promise<CommentRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, content_id, parent_id, author_name, body, status, user_id, created_at FROM comments WHERE site_id=1 AND content_id=? AND status='approved' ORDER BY created_at, id",
  ).bind(contentId).all<CommentRow>();
  return results;
}

export async function approvedCount(env: Env, contentId: number): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE site_id=1 AND content_id=? AND status='approved'")
    .bind(contentId).first<{ n: number }>();
  return Number(row?.n || 0);
}

/* ------------------------------------------------------------------- tokens */
// Stateless form token: HMAC over the post id and a 24-hour bucket. Pages are
// cached for a day, and the previous bucket is accepted too, so a form served
// from the cache keeps working.

const BUCKET = 24 * 60 * 60 * 1000;
const bucketNow = (): number => Math.floor(Date.now() / BUCKET);

export const commentToken = async (secret: string, contentId: number): Promise<string> => {
  const b = bucketNow();
  return `${b}.${await hmac(secret, `comment:${contentId}:${b}`)}`;
};

export async function validCommentToken(secret: string, contentId: number, token: string): Promise<boolean> {
  const [rawBucket, sig] = token.split('.');
  const b = Number(rawBucket);
  if (!sig || !Number.isInteger(b)) return false;
  const now = bucketNow();
  if (b > now || b < now - 1) return false;
  const expected = await hmac(secret, `comment:${contentId}:${b}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/* --------------------------------------------------------------- rendering */

/** Plain text -> one or more paragraphs. All HTML is escaped first. */
export function commentBody(body: string): string {
  const safe = esc(body.trim().slice(0, 4000));
  const paragraphs = safe.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

export const NOTICES: Record<string, { ok: boolean; text: string }> = {
  pending: { ok: true, text: 'Thanks! Your comment is waiting for moderation.' },
  published: { ok: true, text: 'Thanks! Your comment is published.' },
  closed: { ok: false, text: 'Comments are closed on this post.' },
  invalid: { ok: false, text: 'Add your name, a valid email address and a comment.' },
  rate: { ok: false, text: 'You are commenting too quickly. Please wait a few minutes.' },
  failed: { ok: false, text: 'Your comment could not be saved. Please try again.' },
};

type RenderOpts = {
  comments: CommentRow[];
  count: number;
  tz: string;
  contentId: number;
  token: string;
  notice?: string;
  replyTo?: number;
  action?: string;
  /** false = comments are closed: show what exists, hide the form. */
  open?: boolean;
};

export function renderCommentsHtml(opts: RenderOpts): string {
  const { comments, count, tz, contentId, token } = opts;
  const action = opts.action || '/comments';
  const open = opts.open !== false;
  const notice = opts.notice ? NOTICES[opts.notice] : undefined;

  const byParent = new Map<number, CommentRow[]>();
  const ids = new Set(comments.map((c) => c.id));
  for (const c of comments) {
    const parent = c.parent_id && ids.has(c.parent_id) ? c.parent_id : 0;
    const list = byParent.get(parent) || [];
    list.push(c);
    byParent.set(parent, list);
  }

  const renderList = (parent: number, depth: number): string => {
    const rows = byParent.get(parent) || [];
    if (!rows.length) return '';
    const items = rows.map((c) => {
      const children = depth < 4 ? renderList(c.id, depth + 1) : '';
      return `<li class="comment" id="comment-${c.id}">
  <div class="comment-meta"><strong class="comment-author">${esc(c.author_name)}</strong> <time datetime="${esc(c.created_at)}">${esc(formatDate(c.created_at, tz))}</time>${c.user_id ? ' <span class="comment-staff">staff</span>' : ''}</div>
  <div class="comment-body">${commentBody(c.body)}</div>
  <a class="comment-reply-link" href="?reply_to=${c.id}#comments">Reply</a>${children ? `\n  <ol class="children">${children}</ol>` : ''}
</li>`;
    });
    return `\n<ol class="comment-list">${items.join('')}\n</ol>`;
  };

  const replyTo = opts.replyTo && ids.has(opts.replyTo) ? comments.find((c) => c.id === opts.replyTo) : undefined;
  const noticeHtml = notice
    ? `<p class="comment-notice ${notice.ok ? 'ok' : 'err'}" role="status">${esc(notice.text)}</p>`
    : '';

  return `<section class="comments" id="comments">
<h2>${count === 1 ? '1 comment' : `${count} comments`}</h2>
${noticeHtml}${count ? renderList(0, 0) : '<p class="comment-none">No comments yet. Be the first to write one.</p>'}
${open ? `<h3 class="comment-form-title">${replyTo ? `Reply to ${esc(replyTo.author_name)}` : 'Leave a comment'}</h3>
<p class="comment-note">Your email address is never published.</p>
<form class="comment-form" method="post" action="${esc(action)}#comments">
  <input type="hidden" name="content_id" value="${contentId}">
  <input type="hidden" name="token" value="${esc(token)}">
  <input type="hidden" name="parent_id" value="${replyTo ? replyTo.id : ''}">
  <p class="hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></p>
  <p><label for="comment-name">Name</label><input id="comment-name" type="text" name="name" required maxlength="80" autocomplete="name"></p>
  <p><label for="comment-email">Email</label><input id="comment-email" type="email" name="email" required maxlength="160" autocomplete="email"></p>
  <p><label for="comment-body">Comment</label><textarea id="comment-body" name="body" required minlength="2" maxlength="4000" rows="5"></textarea></p>
  <p><button class="btn" type="submit">Post comment</button></p>
</form>` : '<p class="comment-closed">Comments are closed.</p>'}
</section>`;
}
