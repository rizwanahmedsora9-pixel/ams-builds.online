import { Hono } from 'hono';
import type { AppEnv, ContentRow, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { RESERVED_SLUGS, bumpCache, getSettings } from '../../lib/config';
import { mediaUrl, permalinkStyle, postUrl } from '../../lib/content';
import { sanitizeHtml, slugify } from '../../lib/security';
import { localToUtc, utcToLocal } from '../../lib/time';
import { isInPrimaryMenu, removeUrlFromMenus, syncPageMenu } from '../../lib/menus';
import {
  bulkBar, card, emptyRow, listToolbar, notice, pageHead, pagination, table, tabs, LIST_JS,
} from '../../admin/components';
import { icon } from '../../admin/icons';
import { PICKER_JS, mediaPicker } from '../../admin/media-picker';
import {
  claimLock, countRevisions, deleteRevisions, getRevision, latestAutosave, listRevisions,
  pruneLocks, pruneRevisions, readLock, recordRevision, releaseLock, sameContent, type RevisionRow,
} from '../../admin/revisions';
import { hasColumn, hasPhase2Schema } from '../../lib/schema';
import { activeThemeTemplates } from '../../lib/theme-store';
import { audit } from '../../lib/audit';
import { lockBanner, restoreBanner, revisionDiff, revisionList } from '../../admin/editor-views';
import { csrfField, errorPage, go, html, layout, raw, type Raw } from '../../lib/ui';

/** Pages and posts share one table and one editor; posts add terms, featured image and scheduling. */
const content = new Hono<AppEnv>();

type Kind = 'pages' | 'posts';
const typeOf = (kind: Kind) => (kind === 'pages' ? 'page' : 'post');
const kindOf = (c: Ctx): Kind => c.req.param('kind') as Kind;

// Pages need editor or above. Authors work on posts (their own only).
content.use('/:kind{(?:pages|posts)}/*', guard);
content.use('/:kind{(?:pages|posts)}', guard);
async function guard(c: Ctx, next: () => Promise<void>) {
  if (kindOf(c) === 'pages' && !can(c.var.user, 'manage_pages')) return errorPage(c, 403, 'Your role cannot manage pages.');
  await next();
}
const mayEdit = (c: Ctx, row: { author_id: number | null }) => can(c.var.user, 'edit_others_posts') || row.author_id === c.var.user.id;

type PostStatusFilter = 'all' | 'published' | 'draft' | 'scheduled';
type PostSort = 'title' | 'author' | 'comments' | 'date' | 'order';
type PostListState = {
  status: PostStatusFilter;
  q: string;
  month: string;
  category: string;
  sort: PostSort;
  dir: 'asc' | 'desc';
  p: number;
};
type PostListRow = {
  id: number;
  title: string;
  slug: string;
  status: ContentRow['status'];
  author_id: number | null;
  author: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  categories: string | null;
  tags: string | null;
  comment_count: number;
  pinned: number;
  thumb_key: string | null;
};

function postListState(c: Ctx): PostListState {
  const rawStatus = c.req.query('status') || 'all';
  const rawSort = c.req.query('sort') || 'date';
  const rawDir = c.req.query('dir') || 'desc';
  const rawPage = Number(c.req.query('p')) || 1;
  const month = c.req.query('month') || '';
  const rawCategory = c.req.query('category') || '';
  const categoryId = Number(rawCategory);
  return {
    status: ['all', 'published', 'draft', 'scheduled'].includes(rawStatus) ? rawStatus as PostStatusFilter : 'all',
    q: (c.req.query('q') || '').trim().slice(0, 120),
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : '',
    category: /^\d+$/.test(rawCategory) && Number.isSafeInteger(categoryId) && categoryId > 0 ? rawCategory : '',
    sort: ['title', 'author', 'comments', 'date', 'order'].includes(rawSort) ? rawSort as PostSort : 'date',
    dir: rawDir === 'asc' ? 'asc' : 'desc',
    p: Math.min(100_000, Math.max(1, Math.trunc(rawPage) || 1)),
  };
}

function postListHref(state: PostListState, change: Partial<PostListState> = {}): string {
  const next = { ...state, ...change };
  const params = new URLSearchParams();
  if (next.status !== 'all') params.set('status', next.status);
  if (next.q) params.set('q', next.q);
  if (next.month) params.set('month', next.month);
  if (next.category) params.set('category', next.category);
  if (next.sort !== 'date') params.set('sort', next.sort);
  if (next.dir !== 'desc') params.set('dir', next.dir);
  if (next.p > 1) params.set('p', String(next.p));
  const query = params.toString();
  return '/posts' + (query ? '?' + query : '');
}

function formatPostDate(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    const parts: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(date)) parts[part.type] = part.value;
    return `${parts.year}/${parts.month}/${parts.day} at ${parts.hour}:${parts.minute} ${(parts.dayPeriod || '').toLowerCase()}`.trim();
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
}

function formatPostMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function postListRedirect(c: Ctx, state: PostListState, message: string, isError = false): Response {
  const path = postListHref(state);
  const join = path.includes('?') ? '&' : '?';
  const key = isError ? 'err' : 'ok';
  return c.redirect(c.var.base + path + join + key + '=' + encodeURIComponent(message), 303);
}

/**
 * The row menu under a title: the fast path to everything you do to a post
 * from the list. Plain links and one small form per verb, so it works without
 * JavaScript; CSS reveals it on hover/focus on a wide screen.
 */
function rowActions(c: Ctx, kind: Kind, row: { id: number; pinned?: number }, preview: string, themes: { slug: string; name: string }[] = []): Raw {
  const base = c.var.base;
  const previewMenu = themes.length > 1
    ? html`<details class="row-menu"><summary>Preview in theme…</summary>
        <ul>${themes.map((theme) => html`<li><a href="${preview}${preview.includes('?') ? '&' : '?'}theme=${encodeURIComponent(theme.slug)}" target="_blank" rel="noopener">${theme.name}</a></li>`)}</ul>
      </details>`
    : '';
  return html`<span class="row-actions">
  <a href="${base}/${kind}/${row.id}">Edit</a>
  <a href="${base}/${kind}/${row.id}/quick">Quick edit</a>
  <form method="post" action="${base}/${kind}/${row.id}/duplicate" class="inline"><button type="submit" class="linkish">Duplicate</button></form>
  <a href="${base}/${kind}/${row.id}/revisions">History</a>
  <a href="${preview}" target="_blank" rel="noopener">View</a>
  <form method="post" action="${base}/${kind}/${row.id}/pin" class="inline"><button type="submit" class="linkish">${row.pinned ? 'Unpin' : 'Pin'}</button></form>
  ${previewMenu}
</span>`;
}

async function postsList(c: Ctx): Promise<Response> {
  const state = postListState(c);
  const base = c.var.base;
  const settings = await getSettings(c.env);
  const timezone = settings.timezone || 'UTC';
  const authorOnly = !can(c.var.user, 'edit_others_posts');
  const ownerArgs = authorOnly ? [c.var.user.id] : [];
  const ownerSql = authorOnly ? ' AND author_id=?' : '';
  const per = 30;

  const [statusRows, categories, months] = await Promise.all([
    c.env.DB.prepare(`SELECT status, COUNT(*) AS n FROM content WHERE site_id=1 AND type='post'${ownerSql} GROUP BY status`)
      .bind(...ownerArgs).all<{ status: string; n: number }>(),
    c.env.DB.prepare("SELECT id, name FROM terms WHERE site_id=1 AND taxonomy='category' ORDER BY name COLLATE NOCASE")
      .all<{ id: number; name: string }>(),
    c.env.DB.prepare(`SELECT DISTINCT substr(COALESCE(published_at,created_at),1,7) AS month
      FROM content WHERE site_id=1 AND type='post'${ownerSql} ORDER BY month DESC LIMIT 24`)
      .bind(...ownerArgs).all<{ month: string }>(),
  ]);

  const counts: Record<PostStatusFilter, number> = { all: 0, published: 0, draft: 0, scheduled: 0 };
  for (const row of statusRows.results) {
    if (row.status in counts && row.status !== 'all') counts[row.status as Exclude<PostStatusFilter, 'all'>] = Number(row.n) || 0;
  }
  counts.all = counts.published + counts.draft + counts.scheduled;

  const where = ["c.site_id=1", "c.type='post'"];
  const args: (string | number)[] = [];
  if (authorOnly) { where.push('c.author_id=?'); args.push(c.var.user.id); }
  if (state.status !== 'all') { where.push('c.status=?'); args.push(state.status); }
  if (state.q) {
    where.push('(instr(lower(c.title),lower(?))>0 OR instr(lower(c.body),lower(?))>0)');
    args.push(state.q, state.q);
  }
  if (state.month) { where.push('substr(COALESCE(c.published_at,c.created_at),1,7)=?'); args.push(state.month); }
  if (state.category) {
    where.push("EXISTS (SELECT 1 FROM content_terms filter_ct JOIN terms filter_t ON filter_t.id=filter_ct.term_id WHERE filter_ct.content_id=c.id AND filter_t.site_id=1 AND filter_t.taxonomy='category' AND filter_t.id=?)");
    args.push(Number(state.category));
  }
  const whereSql = where.join(' AND ');
  const sortSql: Record<PostSort, string> = {
    title: 'c.title COLLATE NOCASE',
    author: "COALESCE(u.username,'') COLLATE NOCASE",
    comments: 'comment_count',
    date: 'COALESCE(c.published_at,c.created_at)',
    order: 'c.menu_order',
  };
  const direction = state.dir === 'asc' ? 'ASC' : 'DESC';
  const queryRows = (withComments: boolean) => c.env.DB.prepare(
    `SELECT c.id, c.title, c.slug, c.status, c.author_id, c.published_at, c.created_at, c.updated_at,
            u.username AS author, c.pinned, m.r2_key AS thumb_key,
            (SELECT group_concat(t.name, ', ') FROM content_terms ct JOIN terms t ON t.id=ct.term_id
             WHERE ct.content_id=c.id AND t.site_id=1 AND t.taxonomy='category') AS categories,
            (SELECT group_concat(t.name, ', ') FROM content_terms ct JOIN terms t ON t.id=ct.term_id
             WHERE ct.content_id=c.id AND t.site_id=1 AND t.taxonomy='tag') AS tags,
            ${withComments ? "(SELECT COUNT(*) FROM comments cm WHERE cm.site_id=1 AND cm.content_id=c.id AND cm.status IN ('approved','pending'))" : '0'} AS comment_count
     FROM content c LEFT JOIN users u ON u.id=c.author_id LEFT JOIN media m ON m.id=c.featured_media_id
     WHERE ${whereSql} ORDER BY c.pinned DESC, ${sortSql[state.sort]} ${direction}, c.id DESC LIMIT ? OFFSET ?`,
  ).bind(...args, per + 1, (state.p - 1) * per).all<PostListRow>();

  let listResult;
  try {
    listResult = await queryRows(true);
  } catch (error) {
    // Older installations may be between schema migrations; the table count is cosmetic.
    if (!String(error).toLowerCase().includes('comments')) throw error;
    listResult = await queryRows(false);
  }
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM content c LEFT JOIN users u ON u.id=c.author_id WHERE ${whereSql}`,
  ).bind(...args).first<{ n: number }>();
  const total = Number(totalRow?.n || 0);
  const rows = listResult.results.slice(0, per);
  const style = permalinkStyle(settings);
  const statusTabOptions: [PostStatusFilter, string][] = [
    ['all', 'All'], ['published', 'Published'], ['draft', 'Draft'], ['scheduled', 'Scheduled'],
  ];
  const statusTabs = statusTabOptions.filter(([key]) => key === 'all' || counts[key] > 0);
  const installedThemes = (await c.env.DB.prepare('SELECT slug, name FROM themes ORDER BY name').all<{ slug: string; name: string }>().catch(() => ({ results: [] as { slug: string; name: string }[] }))).results;
  const currentUrl = postListHref(state);
  const bulkAction = `${base}/posts/bulk${currentUrl.slice('/posts'.length)}`;
  const selectedCategory = categories.results.find((term) => String(term.id) === state.category);
  const monthOptions = months.results.filter((row) => /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month));
  const categoryOptions = categories.results;
  const rangeStart = total ? (state.p - 1) * per + 1 : 0;
  const rangeEnd = Math.min((state.p - 1) * per + rows.length, total);

  /** Sortable column: clicking toggles the direction of that column. */
  const sortCol = (label: string, key: PostSort, initial: 'asc' | 'desc', href: (change: { sort: PostSort; dir: 'asc' | 'desc'; p: number }) => string, cls?: string) => {
    const active = state.sort === key;
    const dir = active ? state.dir : initial;
    const next: 'asc' | 'desc' = active ? (state.dir === 'asc' ? 'desc' : 'asc') : initial;
    return { label, cls, sortHref: href({ sort: key, dir: next, p: 1 }), sortState: active ? dir : undefined };
  };

  return layout(c, 'Posts', html`
<section class="list-page" data-list="posts-bulk-form" aria-labelledby="posts-title">
  <form method="post" action="${bulkAction}" id="posts-bulk-form" class="list-bulk-form">${csrfField(c)}</form>
  ${pageHead({
    title: 'Posts',
    sub: total ? `${total} post${total === 1 ? '' : 's'}${authorOnly ? ' of yours' : ''}` : 'Everything you have written, newest first.',
    id: 'posts-title',
    actions: html`<a class="btn" href="${base}/posts/new">${icon('plus', { cls: 'ico--sm' })}Add Post</a>`,
  })}
  ${listToolbar({
    tabs: tabs(statusTabs.map(([key, label]) => ({
        label: html`${label} <span class="tab-count">${counts[key]}</span>`,
        href: postListHref(state, { status: key, p: 1 }),
        current: state.status === key,
    })), { label: 'Post status' }),
    search: {
      action: `${base}/posts`,
      value: state.q,
      placeholder: 'Search posts…',
      label: 'Search posts',
      button: 'Search Posts',
      hidden: {
        status: state.status !== 'all' ? state.status : '',
        month: state.month,
        category: state.category,
        sort: state.sort !== 'date' ? state.sort : '',
        dir: state.dir !== 'desc' ? state.dir : '',
      },
    },
    filters: html`
      <form class="list-filters" method="get" action="${base}/posts">
        <input type="hidden" name="status" value="${state.status}">
        ${state.q ? html`<input type="hidden" name="q" value="${state.q}">` : ''}
        ${state.sort !== 'date' ? html`<input type="hidden" name="sort" value="${state.sort}">` : ''}
        ${state.dir !== 'desc' ? html`<input type="hidden" name="dir" value="${state.dir}">` : ''}
        <label class="sr-only" for="post-month">Filter by date</label>
        <select id="post-month" name="month">
          <option value="">All dates</option>
          ${state.month && !monthOptions.some((row) => row.month === state.month) ? html`<option value="${state.month}" selected>${formatPostMonth(state.month)}</option>` : ''}
          ${monthOptions.map((row) => html`<option value="${row.month}"${state.month === row.month ? raw(' selected') : ''}>${formatPostMonth(row.month)}</option>`)}
        </select>
        <label class="sr-only" for="post-category">Filter by category</label>
        <select id="post-category" name="category">
          <option value="">All categories</option>
          ${state.category && !selectedCategory ? html`<option value="${state.category}" selected>Selected category</option>` : ''}
          ${categoryOptions.map((term) => html`<option value="${term.id}"${state.category === String(term.id) ? raw(' selected') : ''}>${term.name}</option>`)}
        </select>
        <button class="btn ghost small" type="submit">Filter</button>
      </form>`,
  })}
  ${bulkBar({ formId: 'posts-bulk-form', id: 'posts-bulk', count: rows.length })}
  ${rows.length
    ? table({
      cls: 'list-table',
      columns: [
        { label: html`<input type="checkbox" data-select-all aria-label="Select all posts">`, cls: 'list-check' },
        sortCol('Title', 'title', 'asc', (change) => postListHref(state, change)),
        sortCol('Author', 'author', 'asc', (change) => postListHref(state, change), 'col-hide-sm'),
        { label: 'Categories', cls: 'col-hide-md' },
        { label: 'Tags', cls: 'col-hide-md' },
        { ...sortCol('Comments', 'comments', 'desc', (change) => postListHref(state, change), 'list-comments'), align: 'center' as const },
        sortCol('Date', 'date', 'desc', (change) => postListHref(state, change), 'list-date'),
      ],
      rows: rows.map((row) => {
        const url = postUrl(row, style);
        const date = row.status === 'published' ? row.published_at || row.created_at : row.status === 'scheduled' ? row.published_at || row.created_at : row.updated_at;
        const dateLabel = row.status === 'published' ? 'Published' : row.status === 'scheduled' ? 'Scheduled' : 'Last modified';
        const preview = url + (row.status === 'published' ? '' : '?preview=1');
        return [
          html`<input type="checkbox" name="ids" value="${row.id}" form="posts-bulk-form" aria-label="Select ${row.title}">`,
          html`<div class="row-lead">
              ${row.thumb_key ? html`<img class="row-thumb" src="${mediaUrl(row.thumb_key)}" alt="" loading="lazy" width="48" height="48">` : html`<span class="row-thumb row-thumb--empty" aria-hidden="true">${icon('file', { cls: 'ico--sm' })}</span>`}
              <div class="row-lead__body">
                <a class="row-title" href="${base}/posts/${row.id}">${row.pinned ? html`<span class="pin" title="Pinned">${icon('pin', { cls: 'ico--sm' })}<span class="sr-only">Pinned: </span>` : ''}${row.title || '(untitled)'}</a>
                <span class="row-meta">${row.status !== 'published' ? html`<span class="badge ${row.status}">${row.status}</span>` : ''}<span class="row-slug">/${row.slug}</span></span>
                ${rowActions(c, 'posts', row, preview, installedThemes)}
              </div>
            </div>`,
          row.author || '—',
          row.categories || '—',
          row.tags || '—',
          html`<span class="comment-count" aria-label="${row.comment_count} comments">${row.comment_count}</span>`,
          html`<span class="row-date"><strong>${dateLabel}</strong><time datetime="${date}">${formatPostDate(date, timezone)}</time></span>`,
        ];
      }),
    })
    : emptyRow(7, {
      title: 'No posts match',
      body: state.q || state.month || state.category || state.status !== 'all'
        ? 'Try a different search or clear the filters.'
        : 'Your first post is one click away.',
      action: html`<a class="btn" href="${base}/posts/new">Write a post</a>`,
    })}
  ${pagination({
    prev: state.p > 1 ? postListHref(state, { p: state.p - 1 }) : undefined,
    next: total > state.p * per ? postListHref(state, { p: state.p + 1 }) : undefined,
    prevLabel: 'Newer',
    nextLabel: 'Older',
    info: total ? `${rangeStart}–${rangeEnd} of ${total}` : '0 posts',
  })}
  ${raw(LIST_JS)}
</section>`, '/posts');
}

type PageStatusFilter = 'all' | 'published' | 'draft';
type PageListState = {
  status: PageStatusFilter;
  q: string;
  month: string;
  sort: PostSort;
  dir: 'asc' | 'desc';
  p: number;
};
type PageListRow = {
  id: number;
  title: string;
  slug: string;
  status: 'published' | 'draft';
  published_at: string | null;
  created_at: string;
  updated_at: string;
  author: string | null;
  comment_count: number;
  pinned: number;
};

function pageListState(c: Ctx): PageListState {
  const rawStatus = c.req.query('status') || 'all';
  const rawSort = c.req.query('sort') || 'date';
  const rawPage = Number(c.req.query('p')) || 1;
  const month = c.req.query('month') || '';
  return {
    status: ['all', 'published', 'draft'].includes(rawStatus) ? rawStatus as PageStatusFilter : 'all',
    q: (c.req.query('q') || '').trim().slice(0, 120),
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : '',
    sort: ['title', 'author', 'comments', 'date', 'order'].includes(rawSort) ? rawSort as PostSort : 'date',
    dir: c.req.query('dir') === 'asc' ? 'asc' : 'desc',
    p: Math.min(100_000, Math.max(1, Math.trunc(rawPage) || 1)),
  };
}

function pageListHref(state: PageListState, change: Partial<PageListState> = {}): string {
  const next = { ...state, ...change };
  const params = new URLSearchParams();
  if (next.status !== 'all') params.set('status', next.status);
  if (next.q) params.set('q', next.q);
  if (next.month) params.set('month', next.month);
  if (next.sort !== 'date') params.set('sort', next.sort);
  if (next.dir !== 'desc') params.set('dir', next.dir);
  if (next.p > 1) params.set('p', String(next.p));
  const query = params.toString();
  return '/pages' + (query ? '?' + query : '');
}

function pageListRedirect(c: Ctx, state: PageListState, message: string, isError = false): Response {
  const path = pageListHref(state);
  const key = isError ? 'err' : 'ok';
  return c.redirect(c.var.base + path + (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(message), 303);
}

async function pagesList(c: Ctx): Promise<Response> {
  const state = pageListState(c);
  const base = c.var.base;
  const settings = await getSettings(c.env);
  const timezone = settings.timezone || 'UTC';
  const per = 30;
  const [statusRows, months] = await Promise.all([
    c.env.DB.prepare("SELECT status, COUNT(*) AS n FROM content WHERE site_id=1 AND type='page' GROUP BY status")
      .all<{ status: string; n: number }>(),
    c.env.DB.prepare("SELECT DISTINCT substr(COALESCE(published_at,created_at),1,7) AS month FROM content WHERE site_id=1 AND type='page' ORDER BY month DESC LIMIT 24")
      .all<{ month: string }>(),
  ]);
  const counts: Record<PageStatusFilter, number> = { all: 0, published: 0, draft: 0 };
  for (const row of statusRows.results) {
    if (row.status === 'published' || row.status === 'draft') counts[row.status] = Number(row.n) || 0;
  }
  counts.all = counts.published + counts.draft;

  const where = ["c.site_id=1", "c.type='page'"];
  const args: (string | number)[] = [];
  if (state.status !== 'all') { where.push('c.status=?'); args.push(state.status); }
  if (state.q) {
    where.push('(instr(lower(c.title),lower(?))>0 OR instr(lower(c.body),lower(?))>0)');
    args.push(state.q, state.q);
  }
  if (state.month) { where.push('substr(COALESCE(c.published_at,c.created_at),1,7)=?'); args.push(state.month); }
  const whereSql = where.join(' AND ');
  const direction = state.dir === 'asc' ? 'ASC' : 'DESC';
  const sortSql: Record<PostSort, string> = {
    title: 'c.title COLLATE NOCASE', author: "COALESCE(u.username,'') COLLATE NOCASE",
    comments: 'comment_count', date: 'COALESCE(c.published_at,c.created_at)',
    order: 'c.menu_order',
  };
  const queryRows = (withComments: boolean) => c.env.DB.prepare(
    `SELECT c.id, c.title, c.slug, c.status, c.published_at, c.created_at, c.updated_at, c.pinned, u.username AS author,
            ${withComments ? "(SELECT COUNT(*) FROM comments cm WHERE cm.site_id=1 AND cm.content_id=c.id AND cm.status IN ('approved','pending'))" : '0'} AS comment_count
     FROM content c LEFT JOIN users u ON u.id=c.author_id LEFT JOIN media m ON m.id=c.featured_media_id
     WHERE ${whereSql} ORDER BY c.pinned DESC, ${sortSql[state.sort]} ${direction}, c.id DESC LIMIT ? OFFSET ?`,
  ).bind(...args, per + 1, (state.p - 1) * per).all<PageListRow>();
  let listResult;
  try {
    listResult = await queryRows(true);
  } catch (error) {
    if (!String(error).toLowerCase().includes('comments')) throw error;
    listResult = await queryRows(false);
  }
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM content c WHERE ${whereSql}`).bind(...args).first<{ n: number }>();
  const total = Number(totalRow?.n || 0);
  const rows = listResult.results.slice(0, per);
  const statusTabs: [PageStatusFilter, string][] = [['all', 'All'], ['published', 'Published'], ['draft', 'Draft']];
  const installedThemes = (await c.env.DB.prepare('SELECT slug, name FROM themes ORDER BY name').all<{ slug: string; name: string }>().catch(() => ({ results: [] as { slug: string; name: string }[] }))).results;
  const allPages = (await c.env.DB.prepare(
    "SELECT id, title, status, COALESCE(menu_order,0) AS menu_order FROM content WHERE site_id=1 AND type='page' ORDER BY COALESCE(menu_order,0) ASC, title COLLATE NOCASE ASC LIMIT 200",
  ).all<{ id: number; title: string; status: string; menu_order: number }>().catch(() => ({ results: [] as { id: number; title: string; status: string; menu_order: number }[] }))).results;
  const currentUrl = pageListHref(state);
  const bulkAction = `${base}/pages/bulk${currentUrl.slice('/pages'.length)}`;
  const monthOptions = months.results.filter((row) => /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month));
  const rangeStart = total ? (state.p - 1) * per + 1 : 0;
  const rangeEnd = Math.min((state.p - 1) * per + rows.length, total);

  /** Sortable column: clicking toggles the direction of that column. */
  const sortCol = (label: string, key: PostSort, initial: 'asc' | 'desc', href: (change: { sort: PostSort; dir: 'asc' | 'desc'; p: number }) => string, cls?: string) => {
    const active = state.sort === key;
    const dir = active ? state.dir : initial;
    const next: 'asc' | 'desc' = active ? (state.dir === 'asc' ? 'desc' : 'asc') : initial;
    return { label, cls, sortHref: href({ sort: key, dir: next, p: 1 }), sortState: active ? dir : undefined };
  };

  return layout(c, 'Pages', html`
<section class="list-page" data-list="pages-bulk-form" aria-labelledby="pages-title">
  <form method="post" action="${bulkAction}" id="pages-bulk-form" class="list-bulk-form">${csrfField(c)}</form>
  ${pageHead({
    title: 'Pages',
    sub: total ? `${total} page${total === 1 ? '' : 's'}` : 'Standalone pages: about, contact, landing pages.',
    id: 'pages-title',
    actions: html`<a class="btn" href="${base}/pages/new">${icon('plus', { cls: 'ico--sm' })}Add Page</a>`,
  })}
  ${listToolbar({
    tabs: tabs(statusTabs.map(([key, label]) => ({
      label: html`${label} <span class="tab-count">${counts[key]}</span>`,
      href: pageListHref(state, { status: key, p: 1 }),
      current: state.status === key,
    })), { label: 'Page status' }),
    search: {
      action: `${base}/pages`,
      value: state.q,
      placeholder: 'Search pages…',
      label: 'Search pages',
      button: 'Search Pages',
      hidden: {
        status: state.status !== 'all' ? state.status : '',
        month: state.month,
        sort: state.sort !== 'date' ? state.sort : '',
        dir: state.dir !== 'desc' ? state.dir : '',
      },
    },
    filters: html`
      <form class="list-filters" method="get" action="${base}/pages">
        <input type="hidden" name="status" value="${state.status}">
        ${state.q ? html`<input type="hidden" name="q" value="${state.q}">` : ''}
        ${state.sort !== 'date' ? html`<input type="hidden" name="sort" value="${state.sort}">` : ''}
        ${state.dir !== 'desc' ? html`<input type="hidden" name="dir" value="${state.dir}">` : ''}
        <label class="sr-only" for="page-month">Filter by date</label>
        <select id="page-month" name="month">
          <option value="">All dates</option>
          ${state.month && !monthOptions.some((row) => row.month === state.month) ? html`<option value="${state.month}" selected>${formatPostMonth(state.month)}</option>` : ''}
          ${monthOptions.map((row) => html`<option value="${row.month}"${state.month === row.month ? raw(' selected') : ''}>${formatPostMonth(row.month)}</option>`)}
        </select>
        <button class="btn ghost small" type="submit">Filter</button>
      </form>`,
  })}
  ${bulkBar({ formId: 'pages-bulk-form', id: 'pages-bulk', count: rows.length })}
  ${rows.length
    ? table({
      cls: 'list-table',
      columns: [
        { label: html`<input type="checkbox" data-select-all aria-label="Select all pages">`, cls: 'list-check' },
        sortCol('Title', 'title', 'asc', (change) => pageListHref(state, change)),
        sortCol('Author', 'author', 'asc', (change) => pageListHref(state, change), 'col-hide-sm'),
        { ...sortCol('Comments', 'comments', 'desc', (change) => pageListHref(state, change), 'list-comments'), align: 'center' as const },
        sortCol('Date', 'date', 'desc', (change) => pageListHref(state, change), 'list-date'),
      ],
      rows: rows.map((row) => {
        const url = settings.home_page_id === String(row.id) ? '/' : '/' + row.slug;
        const date = row.status === 'published' ? row.published_at || row.created_at : row.updated_at;
        const dateLabel = row.status === 'published' ? 'Published' : 'Last modified';
        const preview = url + (row.status === 'published' ? '' : '?preview=1');
        return [
          html`<input type="checkbox" name="ids" value="${row.id}" form="pages-bulk-form" aria-label="Select ${row.title}">`,
          html`<div class="row-lead">
              <span class="row-thumb row-thumb--empty" aria-hidden="true">${icon('file', { cls: 'ico--sm' })}</span>
              <div class="row-lead__body">
                <a class="row-title" href="${base}/pages/${row.id}">${row.pinned ? html`<span class="pin" title="Pinned">${icon('pin', { cls: 'ico--sm' })}<span class="sr-only">Pinned: </span>` : ''}${row.title || '(untitled)'}</a>
                <span class="row-meta">${row.status === 'draft' ? html`<span class="badge draft">draft</span>` : ''}${settings.home_page_id === String(row.id) ? html`<span class="badge published">home page</span>` : ''}<span class="row-slug">/${row.slug}</span></span>
                ${rowActions(c, 'pages', row, preview, installedThemes)}
              </div>
            </div>`,
          row.author || '—',
          html`<span class="comment-count" aria-label="${row.comment_count} comments">${row.comment_count}</span>`,
          html`<span class="row-date"><strong>${dateLabel}</strong><time datetime="${date}">${formatPostDate(date, timezone)}</time></span>`,
        ];
      }),
    })
    : emptyRow(5, {
      title: 'No pages match',
      body: state.q || state.month || state.status !== 'all' ? 'Try a different search or clear the filters.' : 'Add an about page or a landing page.',
      action: html`<a class="btn" href="${base}/pages/new">Add a page</a>`,
    })}
  ${pagination({
    prev: state.p > 1 ? pageListHref(state, { p: state.p - 1 }) : undefined,
    next: total > state.p * per ? pageListHref(state, { p: state.p + 1 }) : undefined,
    prevLabel: 'Newer',
    nextLabel: 'Older',
    info: total ? `${rangeStart}–${rangeEnd} of ${total}` : '0 pages',
  })}
  ${card({
    title: 'Page order',
    body: html`<p class="hint" style="margin-top:0">A lower number comes first. This order drives the <code>{{#each pages}}</code> list in a theme, so a menu built from it follows the same sequence. Leave everything at 0 to fall back to alphabetical.</p>
    <form method="post" action="${base}/pages/order" class="order-form">
      ${csrfField(c)}
      <ol class="order-list">
        ${allPages.map((page) => html`<li class="order-list__item">
          <input type="hidden" name="id" value="${page.id}">
          <label class="sr-only" for="order-${page.id}">Order for ${page.title}</label>
          <input type="number" id="order-${page.id}" name="order" value="${page.menu_order}" min="0" max="9999" step="1" inputmode="numeric" class="order-input">
          <a href="${base}/pages/${page.id}">${page.title}</a>
          <span class="muted">${page.status}</span>
        </li>`)}
      </ol>
      <p class="row" style="margin-bottom:0"><button class="btn small" type="submit">Save order</button></p>
    </form>`,
  })}
  ${raw(LIST_JS)}
</section>`, '/pages');
}

/* -------------------------------------------------------------------- list */
content.get('/:kind{(?:pages|posts)}', async (c) => kindOf(c) === 'posts' ? postsList(c) : pagesList(c));

content.post('/pages/bulk', async (c) => {
  const state = pageListState(c);
  const action = String(c.var.form.get('action') ?? '');
  if (!['publish', 'draft', 'delete'].includes(action)) {
    return pageListRedirect(c, state, 'Choose a bulk action first.', true);
  }
  const rawIds = c.var.form.getAll('ids').map((value) => Number(value));
  const ids = [...new Set(rawIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const limited = ids.length > 100;
  ids.length = Math.min(ids.length, 100);
  if (!ids.length) return pageListRedirect(c, state, 'Select at least one page.', true);

  const placeholders = ids.map(() => '?').join(',');
  const selected = await c.env.DB.prepare(
    `SELECT id, slug, status FROM content WHERE site_id=1 AND type='page' AND id IN (${placeholders})`,
  ).bind(...ids).all<{ id: number; slug: string; status: string }>();
  const rows = selected.results;
  if (!rows.length) return pageListRedirect(c, state, 'No selected pages could be changed.', true);

  const db = c.env.DB;
  const settings = await getSettings(c.env);
  const pageUrl = (row: { id: number; slug: string }) => settings.home_page_id === String(row.id) ? '/' : '/' + row.slug;
  const now = new Date().toISOString();
  if (action === 'delete') {
    for (const row of rows) await removeUrlFromMenus(c.env, pageUrl(row));
    await db.batch(rows.flatMap((row) => [
      db.prepare('DELETE FROM content_terms WHERE content_id=?').bind(row.id),
      db.prepare('DELETE FROM comments WHERE content_id=?').bind(row.id),
      db.prepare("DELETE FROM content WHERE id=? AND site_id=1 AND type='page'").bind(row.id),
      db.prepare("DELETE FROM settings WHERE site_id=1 AND key='home_page_id' AND value=?").bind(String(row.id)),
    ]));
    await bumpCache(c.env, c.var.cfg);
    return pageListRedirect(c, state, `${rows.length} page${rows.length === 1 ? '' : 's'} deleted${limited ? ' (the first 100 selected were processed)' : ''}.`);
  }

  const idList = rows.map(() => '?').join(',');
  if (action === 'publish') {
    await db.prepare(
      `UPDATE content SET status='published',
         published_at=CASE WHEN published_at IS NULL OR published_at>? THEN ? ELSE published_at END,
         updated_at=? WHERE id IN (${idList}) AND site_id=1 AND type='page'`,
    ).bind(now, now, now, ...rows.map((row) => row.id)).run();
  } else {
    await db.prepare(
      `UPDATE content SET status='draft', updated_at=? WHERE id IN (${idList}) AND site_id=1 AND type='page'`,
    ).bind(now, ...rows.map((row) => row.id)).run();
    for (const row of rows) await removeUrlFromMenus(c.env, pageUrl(row));
  }
  await bumpCache(c.env, c.var.cfg);
  const verb = action === 'publish' ? 'published' : 'moved to draft';
  return pageListRedirect(c, state, `${rows.length} page${rows.length === 1 ? '' : 's'} ${verb}${limited ? ' (the first 100 selected were processed)' : ''}.`);
});

content.post('/posts/bulk', async (c) => {
  const state = postListState(c);
  const action = String(c.var.form.get('action') ?? '');
  if (!['publish', 'draft', 'delete'].includes(action)) {
    return postListRedirect(c, state, 'Choose a bulk action first.', true);
  }
  const rawIds = c.var.form.getAll('ids').map((value) => Number(value));
  const ids = [...new Set(rawIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const limited = ids.length > 100;
  ids.length = Math.min(ids.length, 100);
  if (!ids.length) return postListRedirect(c, state, 'Select at least one post.', true);

  const authorOnly = !can(c.var.user, 'edit_others_posts');
  const ownerSql = authorOnly ? ' AND author_id=?' : '';
  const ownerArgs = authorOnly ? [c.var.user.id] : [];
  const placeholders = ids.map(() => '?').join(',');
  const owned = await c.env.DB.prepare(
    `SELECT id FROM content WHERE site_id=1 AND type='post' AND id IN (${placeholders})${ownerSql}`,
  ).bind(...ids, ...ownerArgs).all<{ id: number }>();
  const validIds = owned.results.map((row) => row.id);
  if (!validIds.length) return postListRedirect(c, state, 'No selected posts could be changed.', true);

  const db = c.env.DB;
  const idList = validIds.map(() => '?').join(',');
  const now = new Date().toISOString();
  if (action === 'delete') {
    const statements = validIds.flatMap((id) => [
      db.prepare('DELETE FROM content_terms WHERE content_id=?').bind(id),
      db.prepare('DELETE FROM comments WHERE content_id=?').bind(id),
      db.prepare("DELETE FROM content WHERE id=? AND site_id=1 AND type='post'").bind(id),
    ]);
    await db.batch(statements);
    await bumpCache(c.env, c.var.cfg);
    return postListRedirect(c, state, `${validIds.length} post${validIds.length === 1 ? '' : 's'} deleted${limited ? ' (the first 100 selected were processed)' : ''}.`);
  }

  const ownerFilter = authorOnly ? ' AND author_id=?' : '';
  if (action === 'publish') {
    await db.prepare(
      `UPDATE content SET status='published',
         published_at=CASE WHEN published_at IS NULL OR published_at>? THEN ? ELSE published_at END,
         updated_at=? WHERE id IN (${idList}) AND site_id=1 AND type='post'${ownerFilter}`,
    ).bind(now, now, now, ...validIds, ...ownerArgs).run();
  } else {
    await db.prepare(
      `UPDATE content SET status='draft', updated_at=?
       WHERE id IN (${idList}) AND site_id=1 AND type='post'${ownerFilter}`,
    ).bind(now, ...validIds, ...ownerArgs).run();
  }
  await bumpCache(c.env, c.var.cfg);
  const verb = action === 'publish' ? 'published' : 'moved to draft';
  return postListRedirect(c, state, `${validIds.length} post${validIds.length === 1 ? '' : 's'} ${verb}${limited ? ' (the first 100 selected were processed)' : ''}.`);
});

/* ------------------------------------------------------------------ editor */
/**
 * Editor styles live here rather than in the shared ADMIN_CSS so the
 * classic/modern choice and the Text/HTML toggle look right on both skins.
 */
const EDITOR_CSS = `<style>
.ams-editor{margin-bottom:.4rem}
.ams-editor-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:.45rem}
.ams-editor-switch{display:inline-flex;border:1px solid var(--line);border-radius:.45rem;overflow:hidden;background:var(--card)}
.ams-editor-switch button{padding:.3rem .8rem;border:0;border-left:1px solid var(--line);background:var(--card);color:var(--fg);font:inherit;font-size:.82rem;cursor:pointer;line-height:1.5}
.ams-editor-switch button:first-child{border-left:0}
.ams-editor-switch button[aria-pressed=true]{background:var(--accent);color:var(--accent-fg)}
.ams-editor-bar .hint{margin:0;flex:1 1 12rem}
.ams-editor-pane[hidden]{display:none!important}
.ams-editor .toolbar{margin-bottom:.4rem}
.ams-editor textarea.code,.ams-editor .visual-editor{min-height:22rem;margin:0}
.ams-editor-status{margin:.35rem 0 0;color:var(--muted);font-size:.78rem;min-height:1.1em}
/* Classic: compact WP-style chrome — small square buttons over a plain box. */
.ams-editor.is-classic .ams-editor-bar{display:none}
.ams-editor.is-classic .toolbar{gap:.15rem;margin:0;padding:.35rem;border:1px solid var(--line);border-bottom:0;border-radius:.35rem .35rem 0 0;background:var(--bg)}
.ams-editor.is-classic .toolbar button{padding:.2rem .45rem;font-size:.8rem;border-radius:.2rem;background:var(--card)}
.ams-editor.is-classic textarea.code,.ams-editor.is-classic .visual-editor{border-radius:0 0 .35rem .35rem;min-height:24rem}
.ams-editor.is-classic .ams-editor-status{padding:0 .2rem}
/* Modern: roomy writing surface, a framed toolbar and generous spacing. */
.ams-editor.is-modern textarea.code,.ams-editor.is-modern .visual-editor{min-height:26rem;padding:1.1rem 1.2rem;font-size:1rem;line-height:1.7}
.ams-editor.is-modern .toolbar{gap:.35rem;padding:.5rem;border:1px solid var(--line);border-radius:.55rem;background:var(--bg)}
.ams-editor.is-modern textarea.code{font-size:.92rem;line-height:1.65}
.ams-mode-dialog .ams-mode-options{display:grid;gap:.5rem;margin:1rem 0}
.ams-mode-dialog .ams-mode-option{display:block;width:100%;padding:.75rem .85rem;border:1px solid var(--line);border-radius:.5rem;background:var(--card);color:var(--fg);font:inherit;text-align:left;cursor:pointer}
.ams-mode-dialog .ams-mode-option:hover,.ams-mode-dialog .ams-mode-option:focus-visible{border-color:var(--accent);outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 25%,transparent)}
.ams-mode-dialog .ams-mode-option b{display:block;font-size:.95rem;margin:0 0 .2rem}
.ams-mode-dialog .ams-mode-option span{display:block;color:var(--muted);font-size:.82rem;font-weight:400}
.ams-mode-dialog .ams-mode-note{display:flex;align-items:center;gap:.5rem;font-weight:400;font-size:.85rem;color:var(--muted);margin:.2rem 0 0}
</style>`;

/**
 * One editor for pages and posts with two skins (classic / modern) and a
 * Text <-> HTML switch that keeps content, caret and scroll position.
 * The markup stays a plain form: without JavaScript the HTML textarea still
 * submits, so nothing can be lost.
 */
const EDITOR_JS = `<script>
(function(){
  var form=document.getElementById('edit');
  if(!form)return;
  var ta=document.getElementById('body'),visual=document.getElementById('visual-editor');
  var box=document.getElementById('content-editor');
  var toolbar=document.getElementById('editor-toolbar'),status=document.getElementById('editor-status');
  var modeSwitch=document.getElementById('editor-mode-switch');
  var modeDialog=document.getElementById('editor-mode-dialog');
  var SKIN_KEY='cms-editor-skin';
  var isNew=form.dataset.isNew==='1';
  var initial=form.dataset.initialSkin==='classic'?'classic':'modern';
  var preferred=(form.dataset.preferredSkin==='classic'||form.dataset.preferredSkin==='modern')?form.dataset.preferredSkin:'';
  var skin=initial,mode='html',savedRange=null;

  function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

  // Content that starts with a <style>/<script> block is source, not markup:
  // loading it into a contenteditable would run or hide it, so it stays in HTML.
  function hasRawBlock(src){return /^\\s*(?:<!--[\\s\\S]*?-->\\s*)*(?:<style[\\s>]|<script[\\s>])/i.test(src||'')}

  /* ------------------------------------------------------- selection */
  function rememberSelection(){
    var sel=window.getSelection();
    if(sel&&sel.rangeCount&&visual.contains(sel.anchorNode))savedRange=sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection(){
    var sel=window.getSelection(),range=savedRange;
    if(!range||!visual.contains(range.commonAncestorContainer)){
      range=document.createRange();range.selectNodeContents(visual);range.collapse(false);
    }
    sel.removeAllRanges();sel.addRange(range);
  }
  function caretOffset(){
    var sel=window.getSelection();
    if(!sel||!sel.rangeCount)return 0;
    var range=sel.getRangeAt(0),probe=range.cloneRange();
    if(!visual.contains(range.commonAncestorContainer))return 0;
    probe.selectNodeContents(visual);
    probe.setEnd(range.startContainer,range.startOffset);
    return probe.toString().length;
  }
  function placeCaretAt(offset){
    var walker=document.createTreeWalker(visual,NodeFilter.SHOW_TEXT,null,false);
    var node,seen=0,last=null;
    while((node=walker.nextNode())){
      var len=node.nodeValue.length;
      if(seen+len>=offset){
        var range=document.createRange();
        range.setStart(node,Math.max(0,Math.min(len,offset-seen)));
        range.collapse(true);
        var sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
        savedRange=range.cloneRange();
        return;
      }
      seen+=len;last=node;
    }
    var end=document.createRange();
    if(last)end.setStart(last,last.nodeValue.length);else end.selectNodeContents(visual);
    end.collapse(false);
    var s=window.getSelection();s.removeAllRanges();s.addRange(end);
    savedRange=end.cloneRange();
  }

  /* ------------------------------------------------------------ modes */
  function syncMode(){
    if(box)box.classList.toggle('is-html',mode==='html');
    if(status&&!status.dataset.locked){
      status.textContent=mode==='html'
        ?'Editing HTML source. The Text tab shows the same content visually.'
        :'Editing text. The HTML tab shows the same content as source.';
    }
    if(modeSwitch){
      modeSwitch.querySelectorAll('[data-editor-mode]').forEach(function(btn){
        btn.setAttribute('aria-pressed',String(btn.dataset.editorMode===mode));
      });
    }
    if(visual)visual.setAttribute('aria-hidden',mode==='html'?'true':'false');
    if(ta)ta.setAttribute('aria-hidden',mode==='text'?'true':'false');
  }
  function note(text){
    if(!status)return;
    status.dataset.locked='1';
    status.textContent=text;
    setTimeout(function(){delete status.dataset.locked;syncMode()},4000);
  }

  // Both panes hold the same document at all times: the textarea is the
  // source of truth for HTML, the contenteditable mirrors it when visible.
  function toText(){
    var caret=caretOffset();
    visual.innerHTML=ta.value;
    mode='text';
    ta.hidden=true;visual.hidden=false;
    syncMode();
    visual.focus();
    placeCaretAt(caret);
    visual.scrollTop=ta.scrollTop;
  }
  function toHtml(){
    ta.value=visual.innerHTML;
    mode='html';
    visual.hidden=true;ta.hidden=false;
    syncMode();
    ta.focus();
    var end=ta.value.length;
    ta.setSelectionRange(end,end);
  }
  function setMode(next,focusIt){
    if(next!=='text'&&next!=='html')return;
    if(next===mode){
      syncMode();
      if(focusIt){if(mode==='text')visual.focus();else ta.focus()}
      return;
    }
    if(next==='text'&&hasRawBlock(ta.value)){
      toHtml();
      note('This content starts with a <style> or <script> block, so it stays in HTML mode.');
      return;
    }
    if(next==='text')toText();else toHtml();
  }

  if(modeSwitch){
    modeSwitch.querySelectorAll('[data-editor-mode]').forEach(function(btn){
      btn.addEventListener('click',function(){setMode(btn.dataset.editorMode,true)});
    });
  }

  /* ---------------------------------------------------------- toolbar */
  function insertSnippet(snippet){
    if(mode==='html'){
      var start=ta.selectionStart==null?ta.value.length:ta.selectionStart;
      var end=ta.selectionEnd==null?start:ta.selectionEnd;
      ta.value=ta.value.slice(0,start)+snippet+ta.value.slice(end);
      ta.focus();
      var at=start+snippet.length;
      ta.setSelectionRange(at,at);
    }else{
      restoreSelection();
      document.execCommand('insertHTML',false,snippet);
      rememberSelection();
    }
  }
  if(toolbar){
    toolbar.querySelectorAll('[data-wrap]').forEach(function(btn){
      btn.addEventListener('mousedown',function(e){if(mode==='text')e.preventDefault()});
      btn.addEventListener('click',function(){
        if(mode==='text')rememberSelection();
        var parts=btn.getAttribute('data-wrap').split('|'),open=parts[0],close=parts[1]||'';
        if(btn.dataset.ask){
          var value=prompt(btn.dataset.ask,btn.dataset.def||'');
          if(!value)return;
          open=open.replace('$1',escapeHtml(value));
        }
        if(mode==='text'){
          restoreSelection();
          if(btn.dataset.command){document.execCommand(btn.dataset.command,false,btn.dataset.value||null)}
          else{
            var sel=window.getSelection(),selected='';
            if(sel&&sel.rangeCount){var holder=document.createElement('div');holder.appendChild(sel.getRangeAt(0).cloneContents());selected=holder.innerHTML}
            document.execCommand('insertHTML',false,open+selected+close);
          }
          rememberSelection();
        }else{
          var start=ta.selectionStart==null?ta.value.length:ta.selectionStart;
          var end=ta.selectionEnd==null?start:ta.selectionEnd;
          ta.value=ta.value.slice(0,start)+open+ta.value.slice(start,end)+close+ta.value.slice(end);
          ta.focus();
          ta.setSelectionRange(start+open.length,end+open.length);
        }
      });
    });
  }
  visual.addEventListener('keyup',rememberSelection);
  visual.addEventListener('mouseup',rememberSelection);
  visual.addEventListener('paste',function(e){
    if(mode!=='text')return;
    e.preventDefault();
    var text=((e.clipboardData||window.clipboardData).getData('text/plain')||'');
    document.execCommand('insertText',false,text);
  });

  /* ---------------------------------------------------------- dialogs */
  var htmlDialog=document.getElementById('html-block-dialog'),youtubeDialog=document.getElementById('youtube-dialog');
  function openDialog(dialog,focus){
    rememberSelection();
    if(!dialog)return;
    dialog.showModal();
    setTimeout(function(){focus.focus()},0);
  }
  document.querySelectorAll('[data-close-dialog]').forEach(function(btn){
    btn.addEventListener('click',function(){var d=btn.closest('dialog');if(d)d.close()});
  });
  if(htmlDialog){
    document.getElementById('add-html-block').addEventListener('click',function(){openDialog(htmlDialog,document.getElementById('html-block-input'))});
    document.getElementById('insert-html-block').addEventListener('click',function(){
      var input=document.getElementById('html-block-input'),code=input.value.trim();
      if(!code){input.focus();return}
      insertSnippet('<div class="html-block">\\n'+code+'\\n</div>');
      input.value='';htmlDialog.close();
    });
  }
  function youtubeId(value){
    try{
      var url=new URL(value),host=url.hostname.toLowerCase().replace(/^(www|m)\\./,''),id='';
      if(url.protocol!=='https:'&&url.protocol!=='http:')return '';
      if(host==='youtu.be')id=url.pathname.split('/')[1];
      else if(host==='youtube.com'||host==='youtube-nocookie.com'){
        if(url.pathname==='/watch')id=url.searchParams.get('v')||'';
        else{var parts=url.pathname.split('/');if(['embed','shorts','live'].indexOf(parts[1])!==-1)id=parts[2]}
      }else return '';
      return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:'';
    }catch(e){return ''}
  }
  if(youtubeDialog){
    document.getElementById('add-youtube').addEventListener('click',function(){
      document.getElementById('youtube-error').hidden=true;
      openDialog(youtubeDialog,document.getElementById('youtube-url'));
    });
    document.getElementById('insert-youtube').addEventListener('click',function(){
      var input=document.getElementById('youtube-url'),id=youtubeId(input.value.trim()),error=document.getElementById('youtube-error');
      if(!id){error.hidden=false;input.focus();return}
      var title=document.getElementById('youtube-title').value.trim()||'YouTube video player';
      var embed='<figure class="video-block youtube-video"><div class="video-responsive"><iframe src="https://www.youtube-nocookie.com/embed/'+id+'" title="'+escapeHtml(title)+'" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div></figure>';
      insertSnippet(embed);
      input.value='';document.getElementById('youtube-title').value='';youtubeDialog.close();
    });
  }
  ['youtube-url','youtube-title','html-block-input'].forEach(function(id){
    var el=document.getElementById(id);
    if(!el)return;
    el.addEventListener('keydown',function(e){
      if(e.key==='Enter'&&(id!=='html-block-input'||e.ctrlKey||e.metaKey)){
        e.preventDefault();
        document.getElementById(id==='html-block-input'?'insert-html-block':'insert-youtube').click();
      }
    });
  });

  /* ------------------------------------------------------------ skins */
  function applySkin(next){
    skin=next==='classic'?'classic':'modern';
    if(box){
      box.dataset.skin=skin;
      box.classList.toggle('is-classic',skin==='classic');
      box.classList.toggle('is-modern',skin==='modern');
    }
    document.querySelectorAll('[data-editor-skin-set]').forEach(function(btn){
      btn.setAttribute('aria-pressed',String(btn.dataset.editorSkinSet===skin));
    });
  }

  function useSkin(next){
    applySkin(next);
    try{localStorage.setItem(SKIN_KEY,skin)}catch(e){}
  }
  document.querySelectorAll('[data-editor-skin-set]').forEach(function(btn){
    btn.addEventListener('click',function(){
      useSkin(btn.dataset.editorSkinSet);
      note((skin==='classic'?'Classic':'Modern')+' editor. Remembered on this device.');
    });
  });

  /* ---------------------------------------- classic/modern chooser */
  // "Add New" asks which editor to use unless a preference is remembered.
  function startWriting(){if(mode==='text')visual.focus();else ta.focus()}
  if(modeDialog){
    modeDialog.querySelectorAll('[data-skin-choice]').forEach(function(btn){
      btn.addEventListener('click',function(){
        useSkin(btn.dataset.skinChoice);
        modeDialog.close();
        startWriting();
      });
    });
    modeDialog.addEventListener('cancel',function(){applySkin(initial)});
    var remembered=preferred;
    try{remembered=remembered||localStorage.getItem(SKIN_KEY)||''}catch(e){}
    if(remembered==='classic'||remembered==='modern')applySkin(remembered);
    else modeDialog.showModal();
  }

  /* ----------------------------------------------------------- submit */
  form.addEventListener('submit',function(){
    if(mode==='text')ta.value=visual.innerHTML;
    // A real save supersedes any autosave: stop nagging on the way out.
    dirty=false;
    clearInterval(timer);
  });

  /* --------------------------------------------------------- autosave */
  // Autosave writes to the revision table, never to the live row: a crash or a
  // closed tab leaves a recoverable snapshot and the published page is untouched.
  var autosaveUrl=form.dataset.autosaveUrl||'',lockUrl=form.dataset.lockUrl||'';
  var csrf=form.dataset.csrf||'';
  var autosaveStatus=document.querySelector('[data-autosave-status]');
  var dirty=false,inflight=false,lastSaved=null,timer=null,unloadArmed=false;

  function currentBody(){return mode==='text'?visual.innerHTML:ta.value}
  function markDirty(){
    dirty=true;
    if(!unloadArmed){
      unloadArmed=true;
      window.addEventListener('beforeunload',function(event){
        if(!dirty)return;
        event.preventDefault();
        event.returnValue='';
        return '';
      });
    }
  }
  function ago(date){
    var secs=Math.max(0,Math.round((Date.now()-date.getTime())/1000));
    if(secs<5)return 'just now';
    if(secs<60)return secs+' s ago';
    var mins=Math.round(secs/60);
    return mins+(mins===1?' minute ago':' minutes ago');
  }
  function say(text){
    if(!autosaveStatus)return;
    autosaveStatus.textContent=text;
  }
  function autosave(){
    if(!autosaveUrl||!dirty||inflight)return;
    inflight=true;
    var body=new URLSearchParams();
    body.set('_csrf',csrf);
    body.set('title',(document.getElementById('title')||{}).value||'');
    var excerptEl=document.getElementById('excerpt');
    if(excerptEl)body.set('excerpt',excerptEl.value);
    body.set('body',currentBody());
    fetch(autosaveUrl,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/x-www-form-urlencoded'},body:body.toString()})
      .then(function(res){return res.json().then(function(data){return {ok:res.ok,data:data}})})
      .then(function(result){
        if(result.ok&&result.data.ok){
          dirty=false;lastSaved=new Date(result.data.at||Date.now());
          say(result.data.unchanged?'No new changes to save.':'Autosaved '+ago(lastSaved)+'.');
        }else if(result.data&&result.data.error==='needs-migration'){
          say('Autosave needs a database update: open Updates and run it.');
        }else{
          say('Autosave could not save this time. Your Save button still works.');
        }
      })
      .catch(function(){say('Autosave is offline. Your Save button still works.')})
      .then(function(){inflight=false});
  }
  if(autosaveUrl){
    timer=setInterval(autosave,30000);
    // Keep the "12 s ago" line honest between saves.
    setInterval(function(){if(lastSaved&&!dirty)say('Autosaved '+ago(lastSaved)+'.')},10000);
    ['input','keyup'].forEach(function(type){
      document.getElementById('edit').addEventListener(type,function(event){
        if(event.target.closest('#editor-toolbar'))return;
        markDirty();
      });
    });
    if(ta)ta.addEventListener('input',markDirty);
    if(visual)visual.addEventListener('input',markDirty);
  }

  /* ------------------------------------------------------- edit lock */
  if(lockUrl){
    // A heartbeat every 45 s keeps the row locked while this tab is open, and
    // tells us if somebody took it over in the meantime.
    setInterval(function(){
      var body=new URLSearchParams();body.set('_csrf',csrf);
      fetch(lockUrl,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/x-www-form-urlencoded'},body:body.toString()})
        .then(function(res){return res.json()})
        .then(function(data){
          if(data&&data.holder&&!document.querySelector('[data-lock-banner]')){
            var box=document.getElementById('lock-slot');
            if(!box)return;
            box.innerHTML='<div class="notice warn lock-banner" role="status" data-lock-banner><div><b>'+escapeHtml(data.holder)+' is editing this content now.</b> Saving may overwrite their changes.</div></div>';
          }
        })
        .catch(function(){});
    },45000);
  }

  /* ------------------------------------------------------- media picker */
  // The Image button and the featured-image control open the same dialog, so
  // finding, uploading and describing an image is one flow.
  var pickerUrl=form.dataset.pickerEndpoint||'',pickerUpload=form.dataset.pickerUpload||'';
  var picker=(window.amsMediaPicker&&pickerUrl)?window.amsMediaPicker({uploadUrl:pickerUpload}):null;
  var featuredPreview=document.querySelector('[data-featured-preview]');
  function setFeatured(item){
    var input=document.getElementById('featured-id');
    if(input)input.value=item?String(item.id):'';
    if(featuredPreview){
      featuredPreview.innerHTML=item
        ?'<img src="'+escapeHtml(item.url)+'" alt="'+escapeHtml(item.alt||'')+'">'
        :'<span class="muted">No image chosen</span>';
    }
  }
  document.querySelectorAll('[data-open-picker]').forEach(function(button){
    button.addEventListener('click',function(){
      if(!picker)return;
      picker.open({onPick:function(item){
        if(button.dataset.openPicker==='featured')setFeatured(item);
      }});
    });
  });
  var clearFeatured=document.querySelector('[data-clear-featured]');
  if(clearFeatured)clearFeatured.addEventListener('click',function(){setFeatured(null)});
  var imageButton=document.querySelector('[data-picker-image]');
  if(imageButton){
    imageButton.addEventListener('click',function(){
      if(!picker)return;
      picker.open({onPick:function(item){
        var alt=escapeHtml(item.alt||'');
        insertSnippet('<figure class="image-block"><img src="'+escapeHtml(item.url)+'" alt="'+alt+'" loading="lazy">'+
          (alt?'<figcaption>'+alt+'</figcaption>':'')+'</figure>\n<p></p>');
      }});
    });
  }

  /* ------------------------------------------------------------- boot */
  visual.innerHTML=ta.value;
  mode='html';
  // Existing content opens in the visual editor; a new post has nothing to
  // preview yet, so it starts on the HTML tab with the cursor in the source.
  if(!isNew&&!hasRawBlock(ta.value))toText();else syncMode();
  applySkin(initial);

  /* -------------------------------------------- title, slug, publish */
  var title=document.getElementById('title'),slug=document.getElementById('slug');
  if(slug&&!slug.value){
    title.addEventListener('input',function(){
      if(slug.dataset.touched)return;
      slug.value=title.value.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
    });
    slug.addEventListener('input',function(){slug.dataset.touched=1});
  }
  var st=document.getElementById('status'),when=document.getElementById('when');
  if(st&&when){var sync=function(){when.hidden=st.value==='draft'};st.addEventListener('change',sync);sync()}
  var del=document.getElementById('delete');
  if(del)del.addEventListener('submit',function(e){if(!confirm('Delete this permanently?'))e.preventDefault()});
})();
</script>`;

async function editor(c: Ctx, kind: Kind, row: ContentRow | null): Promise<Response> {
  const type = typeOf(kind);
  const base = c.var.base;
  const settings = await getSettings(c.env);
  const tz = settings.timezone || 'UTC';
  let postFields = html``;

  if (type === 'post') {
    const [terms, mine, images] = await Promise.all([
      c.env.DB.prepare('SELECT id, taxonomy, name FROM terms WHERE site_id=1 ORDER BY name').all<{ id: number; taxonomy: string; name: string }>(),
      row ? c.env.DB.prepare('SELECT term_id FROM content_terms WHERE content_id=?').bind(row.id).all<{ term_id: number }>() : null,
      c.env.DB.prepare("SELECT id, filename, r2_key, alt FROM media WHERE site_id=1 AND mime LIKE 'image/%' ORDER BY id DESC LIMIT 200").all<{ id: number; filename: string; r2_key: string; alt: string }>(),
    ]);
    const selected = new Set((mine?.results || []).map((t) => t.term_id));
    const cats = terms.results.filter((t) => t.taxonomy === 'category');
    const tags = terms.results.filter((t) => t.taxonomy === 'tag' && selected.has(t.id)).map((t) => t.name).join(', ');
    const featured = images.results.find((i) => i.id === row?.featured_media_id);
    postFields = html`
<div class="card">
  <h2>Post options</h2>
  <label for="excerpt">Excerpt</label>
  <textarea id="excerpt" name="excerpt" maxlength="500">${row?.excerpt ?? ''}</textarea>
  <p class="hint">Optional. Shown on listing pages; generated from the content when empty.</p>
  <label>Categories</label>
  ${cats.length ? html`<div class="checks">${cats.map((t) => html`<label class="check"><input type="checkbox" name="cat" value="${t.id}"${selected.has(t.id) ? raw(' checked') : ''}> ${t.name}</label>`)}</div>` : ''}
  <input type="text" name="new_cats" placeholder="Add new categories, comma separated" style="margin-top:.4rem">
  <label for="tags">Tags</label>
  <input type="text" id="tags" name="tags" value="${tags}" placeholder="news, updates">
  <label for="featured-id">Featured image</label>
  <input type="hidden" id="featured-id" name="featured_media_id" value="${row?.featured_media_id ?? ''}">
  <div class="featured-picker">
    <span class="featured-picker__preview" data-featured-preview>
      ${featured ? html`<img src="${mediaUrl(featured.r2_key)}" alt="${featured.alt || ''}">` : html`<span class="muted">No image chosen</span>`}
    </span>
    <span class="row">
      <button class="btn ghost small" type="button" data-open-picker="featured">Choose image</button>
      <button class="btn ghost small" type="button" data-clear-featured>Remove</button>
    </span>
  </div>
  <p class="hint">Picking from the library also lets you set alt text. Upload new images right in the dialog.</p>
</div>`;
  }

  // Editing state: who else is here, and did a crashed tab leave work behind?
  let lockHolder: { username: string } | null = null;
  let autosave: RevisionRow | null = null;
  let revisionCount = 0;
  if (row) {
    await claimLock(c.env, row.id, c.var.user);
    const [holder, latest, revisions] = await Promise.all([
      readLock(c.env, row.id, c.var.user.id),
      latestAutosave(c.env, row.id),
      countRevisions(c.env, row.id),
    ]);
    lockHolder = holder && !holder.mine ? holder : null;
    revisionCount = revisions;
    // Only worth offering if the autosave actually differs from the saved copy.
    if (latest && latest.body !== row.body) autosave = latest;
  }

  const status = row?.status ?? 'draft';
  // Templates the active theme offers. The kind's own template is the default;
  // `page` is not offered to a post (it would drop its date, author and comments).
  const templateOptions = (await activeThemeTemplates(c.env)).templates
    .filter((t) => !['home', 'archive', '404', type, ...(type === 'post' ? ['page'] : [])].includes(t));
  // Pages: one tick puts the page in the header menu (new pages and drafts start ticked).
  const pageUrl = row ? (settings.home_page_id === String(row.id) ? '/' : '/' + row.slug) : null;
  const inMenu = type === 'page' && (!row || row.status === 'draft' || (await isInPrimaryMenu(c.env, pageUrl!)));
  const opt = (v: string, label: string) => html`<option value="${v}"${status === v ? raw(' selected') : ''}>${label}</option>`;
  const title = row ? `Edit ${type}` : `New ${type}`;
  // Which editor opens: the site default, else the classic/modern chooser on Add New.
  const preferred = settings.default_editor === 'classic' || settings.default_editor === 'modern' ? settings.default_editor : '';
  const initialSkin = preferred || 'modern';
  return layout(c, title, html`
${raw(EDITOR_CSS)}
<div class="row between" style="margin-bottom:1rem"><h1 style="margin:0">${title}</h1><a href="${base}/${kind}">&larr; All ${kind}</a></div>
<div id="lock-slot">${lockHolder ? lockBanner(lockHolder, base, kind, row!.id, can(c.var.user, 'edit_others_posts')) : ''}</div>
${autosave ? restoreBanner(autosave, base, kind, row!.id) : ''}
<form method="post" action="${base}/${kind}/save" id="edit"
      data-is-new="${row ? '0' : '1'}" data-initial-skin="${initialSkin}" data-preferred-skin="${preferred}"
      data-autosave-url="${row ? `${base}/${kind}/${row.id}/autosave` : ''}"
      data-lock-url="${row ? `${base}/${kind}/${row.id}/lock` : ''}"
      data-picker-endpoint="${base}/media/picker"
      data-picker-upload="${base}/media/picker/upload"
      data-lock-mine="1"${row ? raw(` data-rowid="${row.id}" data-csrf="${c.var.csrf}"`) : ''}>
  ${csrfField(c)}
  <input type="hidden" name="id" value="${row?.id ?? ''}">
  <div class="card">
    <label for="title" style="margin-top:0">Title</label>
    <input type="text" id="title" name="title" value="${row?.title ?? ''}" required maxlength="200">
    <label for="slug">Slug</label>
    <input type="text" id="slug" name="slug" value="${row?.slug ?? ''}" maxlength="80" autocapitalize="none" placeholder="generated from the title">
    <div class="editor-heading row between">
      <label for="body" id="content-label">Content</label>
      <div class="ams-editor-switch" id="editor-mode-switch" role="group" aria-label="Editor mode">
        <button type="button" data-editor-mode="text" aria-pressed="false">Text</button>
        <button type="button" data-editor-mode="html" aria-pressed="true">HTML</button>
      </div>
    </div>
    <div class="ams-editor is-modern" id="content-editor" data-skin="${initialSkin}">
      <div class="ams-editor-bar">
        <div class="ams-editor-switch" role="group" aria-label="Editor style">
          <button type="button" data-editor-skin-set="classic" aria-pressed="${initialSkin === 'classic' ? 'true' : 'false'}">Classic</button>
          <button type="button" data-editor-skin-set="modern" aria-pressed="${initialSkin === 'modern' ? 'true' : 'false'}">Modern</button>
        </div>
        <p class="hint">Classic shows the original toolbar; Modern keeps the same tools in a wider bar.</p>
      </div>
      <div class="toolbar" id="editor-toolbar" aria-label="Content formatting">
        <button type="button" data-wrap="<strong>|</strong>" data-command="bold" title="Bold"><b>B</b></button>
        <button type="button" data-wrap="<em>|</em>" data-command="italic" title="Italic"><i>I</i></button>
        <button type="button" data-wrap="<h2>|</h2>" data-command="formatBlock" data-value="h2">H2</button>
        <button type="button" data-wrap="<h3>|</h3>" data-command="formatBlock" data-value="h3">H3</button>
        <button type="button" data-wrap="<p>|</p>" data-command="formatBlock" data-value="p" title="Paragraph">&para;</button>
        <button type="button" data-wrap="<ul>&#10;  <li>|</li>&#10;</ul>" data-command="insertUnorderedList">List</button>
        <button type="button" data-wrap="<blockquote>|</blockquote>" data-command="formatBlock" data-value="blockquote">Quote</button>
        <button type="button" data-wrap="<pre><code>|</code></pre>">Code</button>
        <button type="button" data-wrap='<a href="$1">|</a>' data-ask="Link URL" data-def="https://">Link</button>
        <button type="button" id="insert-image" data-picker-image title="Insert an image from the library">Image</button>
        <span class="toolbar-separator" aria-hidden="true"></span>
        <button type="button" id="add-html-block" title="Insert a custom HTML block">&lt;/&gt; HTML block</button>
        <button type="button" id="add-youtube" title="Embed a YouTube video">&#9654; YouTube</button>
      </div>
      <div id="visual-editor" class="visual-editor ams-editor-pane" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="content-label" data-placeholder="Write your content here…" hidden></div>
      <textarea id="body" name="body" class="code ams-editor-pane" spellcheck="true">${row?.body ?? ''}</textarea>
      <p class="ams-editor-status" id="editor-status" role="status" aria-live="polite"></p>
    </div>
    <p class="hint">Text and HTML always show the same content: switch freely, nothing is lost. Add as many HTML and YouTube blocks as you need.</p>
    ${can(c.var.user, 'manage_settings') ? html`<p class="hint">Admin HTML is not sanitized when you save.</p>` : html`<p class="hint">Unsafe HTML is removed when you save. YouTube embeds added with the YouTube button are allowed.</p>`}
  </div>
  ${postFields}
  <div class="card">
    <h2>SEO</h2>
    <label for="seo_title">SEO title</label>
    <input type="text" id="seo_title" name="seo_title" value="${row?.seo_title ?? ''}" maxlength="200">
    <label for="seo_description">Meta description</label>
    <textarea id="seo_description" name="seo_description" maxlength="320">${row?.seo_description ?? ''}</textarea>
  </div>
  <div class="card">
    <h2>Publish</h2>
    <label for="status" style="margin-top:0">Status</label>
    <select id="status" name="status">
      ${opt('draft', 'Draft')}${opt('published', 'Published')}${type === 'post' ? opt('scheduled', 'Scheduled') : ''}
    </select>
    ${type === 'post' ? html`<div id="when">
      <label for="publish_at">Publish date (${tz})</label>
      <input type="datetime-local" id="publish_at" name="publish_at" value="${row?.published_at ? utcToLocal(row.published_at, tz) : ''}">
      <p class="hint">Scheduled posts go live automatically at this time. Leave empty to publish now.</p>
    </div>` : ''}
    ${type === 'page' ? html`<label class="check" style="margin-top:.9rem"><input type="checkbox" name="in_menu" value="1"${inMenu ? raw(' checked') : ''}> Show in the main menu</label>
    <p class="hint">Adds a link to this page in the site header once it is published. Reorder or rename links under <a href="${base}/menus">Menus</a>.</p>` : ''}
    ${templateOptions.length ? html`<label for="template">Template</label>
    <select id="template" name="template">
      <option value="">Default (${type})</option>
      ${templateOptions.map((t) => html`<option value="${t}"${row?.template === t ? raw(' selected') : ''}>${t}</option>`)}
    </select>
    <p class="hint">Templates come from the active theme. Browse them under <a href="${base}/templates">Appearance → Templates</a>.</p>` : ''}
    <p class="row" style="margin:1.1rem 0 0"><button class="btn" type="submit">Save</button></p>
  </div>
</form>
<dialog id="editor-mode-dialog" class="ams-mode-dialog" aria-labelledby="editor-mode-title" aria-describedby="editor-mode-desc">
  <h2 id="editor-mode-title">Choose your editor</h2>
  <p class="hint" id="editor-mode-desc">Both editors edit the same content. You can switch again at any time from the Classic / Modern buttons in the editor.</p>
  <div class="ams-mode-options">
    <button type="button" class="ams-mode-option" data-skin-choice="modern">
      <b>Modern editor</b>
      <span>Wide writing area, Text and HTML tabs, a formatting bar with HTML block and YouTube buttons.</span>
    </button>
    <button type="button" class="ams-mode-option" data-skin-choice="classic">
      <b>Classic editor</b>
      <span>The original compact editor: small formatting buttons above a plain editing box.</span>
    </button>
  </div>
  <p class="ams-mode-note">Your choice is remembered on this device. Change the site default under <a href="${base}/settings#reading">Settings → Reading</a>.</p>
  <div class="row dialog-actions">
    <button type="button" class="btn ghost small" data-close-dialog>Not now</button>
  </div>
</dialog>
<dialog id="html-block-dialog" aria-labelledby="html-block-title">
  <h2 id="html-block-title">Add HTML block</h2>
  <p class="hint">Paste a complete HTML snippet. It will be inserted at your cursor, and you can repeat this for more blocks.</p>
  <label for="html-block-input">HTML code</label>
  <textarea id="html-block-input" class="code" spellcheck="false" placeholder="<div>\n  Your HTML here\n</div>"></textarea>
  <p class="hint">Press Ctrl+Enter (or Cmd+Enter) to insert.</p>
  <div class="row dialog-actions">
    <button type="button" class="btn ghost" data-close-dialog>Cancel</button>
    <button type="button" class="btn" id="insert-html-block">Insert HTML block</button>
  </div>
</dialog>
<dialog id="youtube-dialog" aria-labelledby="youtube-dialog-title">
  <h2 id="youtube-dialog-title">Add YouTube video</h2>
  <p class="hint">Paste a watch, share, Shorts, live, or embed URL.</p>
  <label for="youtube-url">YouTube video URL</label>
  <input type="url" id="youtube-url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off">
  <label for="youtube-title">Video title <span class="muted">(optional)</span></label>
  <input type="text" id="youtube-title" maxlength="200" placeholder="Used for accessibility">
  <p class="form-error" id="youtube-error" role="alert" hidden>Enter a valid YouTube video URL.</p>
  <div class="row dialog-actions">
    <button type="button" class="btn ghost" data-close-dialog>Cancel</button>
    <button type="button" class="btn" id="insert-youtube">Embed video</button>
  </div>
</dialog>
${raw(mediaPicker({ endpoint: `${base}/media/picker` }))}
${row ? card({
  title: 'History',
  actions: html`<a class="btn ghost small" href="${base}/${kind}/${row.id}/revisions">All ${revisionCount} version${revisionCount === 1 ? '' : 's'}</a>`,
  body: html`<p class="hint" style="margin-top:0">A snapshot is kept every time you save, plus an autosave while you type. Restoring is reversible: the current version is saved first.</p>
  <p class="muted" style="margin:0"><span data-autosave-status role="status" aria-live="polite">Autosave is on: your work is kept every 30 seconds.</span></p>`,
}) : ''}
${row ? html`<form method="post" action="${base}/${kind}/${row.id}/delete" id="delete">${csrfField(c)}<button class="btn danger" type="submit">Delete ${type}</button></form>` : ''}
${raw(PICKER_JS)}
${raw(EDITOR_JS)}`, '/' + kind);
}

/* ------------------------------------------------------------- quick edit */
/**
 * Quick edit keeps you on the list: title, slug, status, date, categories and
 * tags only. The full editor stays the place for body, SEO and media.
 */
content.get('/:kind{(?:pages|posts)}/:id{[0-9]+}/quick', async (c) => {
  const kind = kindOf(c);
  const id = Number(c.req.param('id'));
  const base = c.var.base;
  const row = await c.env.DB.prepare('SELECT * FROM content WHERE id=? AND type=? AND site_id=1').bind(id, typeOf(kind)).first<ContentRow>();
  if (!row) return errorPage(c, 404, 'Not found.');
  if (!mayEdit(c, row)) return errorPage(c, 403, 'You can only edit your own posts.');
  const settings = await getSettings(c.env);
  const tz = settings.timezone || 'UTC';
  const rowTerms = kind === 'posts'
    ? (await c.env.DB.prepare(
      `SELECT t.id, t.taxonomy, t.name FROM content_terms ct JOIN terms t ON t.id=ct.term_id WHERE ct.content_id=? ORDER BY t.name`,
    ).bind(id).all<{ id: number; taxonomy: string; name: string }>()).results
    : [];
  return layout(c, `Quick edit: ${row.title}`, html`
${pageHead({ title: 'Quick edit', sub: row.title, actions: html`<a class="btn ghost" href="${base}/${kind}/${id}">Open full editor</a>` })}
<form method="post" action="${base}/${kind}/${id}/quick" class="card">
  ${csrfField(c)}
  <label for="qe-title" style="margin-top:0">Title</label>
  <input type="text" id="qe-title" name="title" value="${row.title}" required maxlength="200">
  <label for="qe-slug">Slug</label>
  <input type="text" id="qe-slug" name="slug" value="${row.slug}" maxlength="80" autocapitalize="none">
  <label for="qe-status">Status</label>
  <select id="qe-status" name="status">
    ${['draft', 'published', ...(kind === 'posts' ? ['scheduled'] : [])].map((value) => html`<option value="${value}"${row.status === value ? raw(' selected') : ''}>${value}</option>`)}
  </select>
  ${kind === 'posts' ? html`<label for="qe-when">Publish date (${tz})</label>
  <input type="datetime-local" id="qe-when" name="publish_at" value="${row.published_at ? utcToLocal(row.published_at, tz) : ''}">
  ${rowTerms.length ? html`<label>Categories</label>
  <div class="checks">${rowTerms.filter((t) => t.taxonomy === 'category').map((t) => html`<label class="check"><input type="checkbox" name="cat" value="${t.id}" checked> ${t.name}</label>`)}</div>` : ''}
  <label for="qe-tags">Tags</label>
  <input type="text" id="qe-tags" name="tags" value="${rowTerms.filter((t) => t.taxonomy === 'tag').map((t) => t.name).join(', ')}">` : ''}
  <p class="row" style="margin-top:1.2rem"><button class="btn" type="submit">Save changes</button> <a class="btn ghost" href="${base}/${kind}">Cancel</a></p>
</form>`, '/' + kind);
});

content.post('/:kind{(?:pages|posts)}/:id{[0-9]+}/quick', async (c) => {
  const kind = kindOf(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM content WHERE id=? AND type=? AND site_id=1').bind(id, typeOf(kind)).first<ContentRow>();
  if (!row) return errorPage(c, 404, 'Not found.');
  if (!mayEdit(c, row)) return errorPage(c, 403, 'You can only edit your own posts.');
  const f = c.var.form;
  const str = (key: string) => String(f.get(key) ?? '');
  const settings = await getSettings(c.env);
  const now = new Date().toISOString();
  const title = str('title').trim().slice(0, 200) || row.title;
  let status = ['draft', 'published', 'scheduled'].includes(str('status')) ? str('status') : row.status;
  if (kind === 'pages' && status === 'scheduled') status = 'published';

  // Slug: only changes when the author changed it; uniqueness is enforced here.
  let slug = slugify(str('slug') || row.slug) || row.slug;
  if (RESERVED_SLUGS.includes(slug) || slug === c.var.cfg.adminSlug) slug += '-' + typeOf(kind);
  const root = slug;
  for (let n = 2; await c.env.DB.prepare('SELECT 1 AS x FROM content WHERE site_id=1 AND type=? AND slug=? AND id<>?').bind(typeOf(kind), slug, id).first(); n++) {
    slug = `${root}-${n}`;
  }

  let publishedAt = row.published_at;
  if (kind === 'posts' && str('publish_at')) publishedAt = localToUtc(str('publish_at'), settings.timezone || 'UTC');
  if (status === 'scheduled' && !publishedAt) {
    return go(c, `/${kind}/${id}/quick`, { err: 'Pick a publish date to schedule this post.' });
  }
  if (status === 'scheduled' && publishedAt && publishedAt <= now) status = 'published';
  if (status === 'published' && (!publishedAt || publishedAt > now)) publishedAt = now;

  await recordRevision(c.env, row, { authorId: c.var.user.id });
  await c.env.DB.prepare('UPDATE content SET title=?, slug=?, status=?, published_at=?, updated_at=? WHERE id=?')
    .bind(title, slug, status, publishedAt, now, id).run();

  if (kind === 'posts') {
    const names = (v: string) => [...new Set(v.split(',').map((x) => x.trim().slice(0, 60)).filter(Boolean))];
    const catIds = f.getAll('cat').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
    const tagNames = names(str('tags'));
    const tagIds = (await Promise.all(tagNames.map((name) => c.env.DB.prepare(
      "SELECT id FROM terms WHERE site_id=1 AND taxonomy='tag' AND slug=?",
    ).bind(slugify(name)).first<{ id: number }>()))).filter(Boolean) as { id: number }[];
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM content_terms WHERE content_id=? AND term_id IN (SELECT id FROM terms WHERE taxonomy='category')").bind(id),
      c.env.DB.prepare("DELETE FROM content_terms WHERE content_id=? AND term_id IN (SELECT id FROM terms WHERE taxonomy='tag')").bind(id),
      ...catIds.map((tid) => c.env.DB.prepare("INSERT OR IGNORE INTO content_terms (content_id,term_id) SELECT ?,id FROM terms WHERE id=? AND site_id=1 AND taxonomy='category'").bind(id, tid)),
      ...tagIds.map((t) => c.env.DB.prepare("INSERT OR IGNORE INTO content_terms (content_id,term_id) VALUES (?,?)").bind(id, t.id)),
    ]);
  }
  await pruneRevisions(c.env, id);
  await bumpCache(c.env, c.var.cfg);
  return go(c, `/${kind}`, { ok: `Updated “${title}”.` });
});

/* ------------------------------------------------------------ duplicate */
content.post('/:kind{(?:pages|posts)}/:id{[0-9]+}/duplicate', async (c) => {
  const kind = kindOf(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM content WHERE id=? AND type=? AND site_id=1').bind(id, typeOf(kind)).first<ContentRow>();
  if (!row) return errorPage(c, 404, 'Not found.');
  if (!mayEdit(c, row)) return errorPage(c, 403, 'You can only duplicate your own posts.');
  const now = new Date().toISOString();
  const base = `${row.slug}-copy`;
  let slug = base;
  for (let n = 2; await c.env.DB.prepare('SELECT 1 AS x FROM content WHERE site_id=1 AND type=? AND slug=?').bind(row.type, slug).first(); n++) {
    slug = `${base}-${n}`;
  }
  const res = await c.env.DB.prepare(
    `INSERT INTO content (site_id,type,title,slug,body,excerpt,status,seo_title,seo_description,featured_media_id,author_id,published_at,template,created_at,updated_at)
     VALUES (1,?,?,?,?,?,'draft',?,?,?,?,NULL,?,?,?)`,
  ).bind(row.type, `${row.title} (copy)`, slug, row.body, row.excerpt, row.seo_title, row.seo_description, row.featured_media_id, c.var.user.id, now, row.template ?? '', now).run();
  const copyId = Number(res.meta.last_row_id);
  await c.env.DB.prepare('INSERT OR IGNORE INTO content_terms (content_id,term_id) SELECT ?,term_id FROM content_terms WHERE content_id=?').bind(copyId, id).run();
  return go(c, `/${kind}/${copyId}`, { ok: 'Duplicated as a draft. The original is untouched.' });
});

/* ------------------------------------------------------------------ pin */
content.post('/:kind{(?:pages|posts)}/:id{[0-9]+}/pin', async (c) => {
  const kind = kindOf(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT pinned FROM content WHERE id=? AND type=? AND site_id=1').bind(id, typeOf(kind)).first<{ pinned: number }>();
  if (!row) return errorPage(c, 404, 'Not found.');
  await c.env.DB.prepare('UPDATE content SET pinned=? WHERE id=?').bind(row.pinned ? 0 : 1, id).run();
  return go(c, `/${kind}`, { ok: row.pinned ? 'Unpinned.' : 'Pinned to the top of the list.' });
});

/* ---------------------------------------------------------------- order */
/** Page order: the editor types a position, the list shows what it will be. */
content.post('/pages/order', async (c) => {
  const ids = c.var.form.getAll('id').map((v) => Number(v));
  const orders = c.var.form.getAll('order').map((v) => Number(v) || 0);
  const stmts = ids
    .map((id, index) => ({ id, order: orders[index] ?? 0 }))
    .filter((row) => Number.isInteger(row.id) && row.id > 0)
    .map((row) => c.env.DB.prepare("UPDATE content SET menu_order=? WHERE id=? AND type='page' AND site_id=1").bind(row.order, row.id));
  if (stmts.length) await c.env.DB.batch(stmts);
  return go(c, '/pages?sort=order&dir=asc', { ok: `Saved the order of ${stmts.length} page${stmts.length === 1 ? '' : 's'}.` });
});

/* --------------------------------------------------------------- revisions */
content.get('/:kind{(?:pages|posts)}/:id{[0-9]+}/revisions', async (c) => {
  const kind = kindOf(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM content WHERE id=? AND type=? AND site_id=1').bind(id, typeOf(kind)).first<ContentRow>();
  if (!row) return errorPage(c, 404, 'Not found.');
  if (!mayEdit(c, row)) return errorPage(c, 403, 'You can only see the history of your own posts.');
  const [rows, phase2] = await Promise.all([listRevisions(c.env, id), hasPhase2Schema(c.env)]);

  return layout(c, `Revisions: ${row.title}`, html`
${pageHead({ title: 'Revisions', sub: row.title, actions: html`<a class="btn ghost" href="${c.var.base}/${kind}/${id}">Back to editor</a>` })}
${card({ title: 'History', body: revisionList(rows, c.var.base, kind, id) })}
${phase2 ? '' : notice('Run updates from the Updates screen to start recording revisions.', { tone: 'warn' })}
`, '/' + kind);
});

content.get('/:kind{(?:pages|posts)}/:id{[0-9]+}/revisions/:rev{[0-9]+}', async (c) => {
  const kind = kindOf(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM content WHERE id=? AND type=? AND site_id=1').bind(id, typeOf(kind)).first<ContentRow>();
  if (!row) return errorPage(c, 404, 'Not found.');
  if (!mayEdit(c, row)) return errorPage(c, 403, 'You can only see the history of your own posts.');
  const rev = await getRevision(c.env, id, Number(c.req.param('rev')));
  if (!rev) return errorPage(c, 404, 'That revision is no longer in the history.');
  return layout(c, `Compare: ${row.title}`, html`
${pageHead({ title: 'Compare versions', sub: row.title, actions: html`<a class="btn ghost" href="${c.var.base}/${kind}/${id}/revisions">All revisions</a>` })}
${card({
  title: `Changes made after this snapshot`,
  actions: html`<form method="post" action="${c.var.base}/${kind}/${id}/revisions/${rev.id}/restore"><button class="btn small" type="submit">Restore this version</button></form>`,
  body: html`<p class="hint" style="margin-top:0">Left: the ${rev.note === 'autosave' ? 'autosave' : 'saved version'} from ${rev.created_at.slice(0, 16).replace('T', ' ')}. Right: what is saved now.</p>
  ${revisionDiff(rev, row)}`,
})}
`, '/' + kind);
});

/** Restore: snapshot what is live now, then write the old version back. */
content.post('/:kind{(?:pages|posts)}/:id{[0-9]+}/revisions/:rev{[0-9]+}/restore', async (c) => {
  const kind = kindOf(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM content WHERE id=? AND type=? AND site_id=1').bind(id, typeOf(kind)).first<ContentRow>();
  if (!row) return errorPage(c, 404, 'Not found.');
  if (!mayEdit(c, row)) return errorPage(c, 403, 'You can only restore your own posts.');
  const rev = await getRevision(c.env, id, Number(c.req.param('rev')));
  if (!rev) return errorPage(c, 404, 'That revision is no longer in the history.');
  await recordRevision(c.env, row, { note: 'restore', authorId: c.var.user.id });
  await c.env.DB.prepare('UPDATE content SET title=?, body=?, excerpt=?, seo_title=?, seo_description=?, status=?, updated_at=? WHERE id=?')
    .bind(rev.title, rev.body, rev.excerpt, rev.seo_title, rev.seo_description, rev.status, new Date().toISOString(), id).run();
  await pruneRevisions(c.env, id);
  await bumpCache(c.env, c.var.cfg);
  return go(c, `/${kind}/${id}`, { ok: `Restored the version from ${rev.created_at.slice(0, 16).replace('T', ' ')} UTC.` });
});

/* ---------------------------------------------------------------- autosave */
/**
 * Autosave stores into the revision table with note='autosave' and never
 * touches the live row, so a crash leaves a recoverable copy while the
 * published page keeps serving the last real save. Returns JSON for the
 * editor's "Saved 12 s ago" line.
 */
content.post('/:kind{(?:pages|posts)}/:id{[0-9]+}/autosave', async (c) => {
  const kind = kindOf(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM content WHERE id=? AND type=? AND site_id=1').bind(id, typeOf(kind)).first<ContentRow>();
  if (!row) return c.json({ ok: false, error: 'not-found' }, 404);
  if (!mayEdit(c, row)) return c.json({ ok: false, error: 'forbidden' }, 403);
  if (!(await hasPhase2Schema(c.env))) return c.json({ ok: false, error: 'needs-migration' }, 409);

  const body = String(c.var.form.get('body') ?? '');
  const title = String(c.var.form.get('title') ?? '').slice(0, 200);
  const excerpt = String(c.var.form.get('excerpt') ?? '').slice(0, 500);
  const draft = { ...row, title, body: can(c.var.user, 'manage_settings') ? body : sanitizeHtml(body), excerpt };
  if (sameContent(row, draft)) return c.json({ ok: true, unchanged: true, at: new Date().toISOString() });

  const at = new Date().toISOString();
  const res = await c.env.DB.prepare(
    `INSERT INTO content_revisions (site_id,content_id,title,slug,body,excerpt,seo_title,seo_description,status,author_id,note,created_at)
     VALUES (1,?,?,?,?,?,?,?,?,?,'autosave',?)`,
  ).bind(id, draft.title, row.slug, draft.body, draft.excerpt, row.seo_title, row.seo_description, row.status, c.var.user.id, at).run();
  await pruneRevisions(c.env, id);
  // Refresh the editing lock while we are here: an autosave is proof of life.
  await claimLock(c.env, id, c.var.user);
  return c.json({ ok: true, id: Number(res.meta.last_row_id), at }, 200, { 'Cache-Control': 'no-store' });
});

/* -------------------------------------------------------------- edit locks */
content.post('/:kind{(?:pages|posts)}/:id{[0-9]+}/lock', async (c) => {
  const id = Number(c.req.param('id'));
  const holder = await claimLock(c.env, id, c.var.user);
  return c.json({ ok: !holder, holder: holder ? holder.username : null }, holder ? 409 : 200, { 'Cache-Control': 'no-store' });
});

content.post('/:kind{(?:pages|posts)}/:id{[0-9]+}/lock/release', async (c) => {
  await releaseLock(c.env, Number(c.req.param('id')), c.var.user.id);
  return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
});

content.post('/:kind{(?:pages|posts)}/:id{[0-9]+}/lock/takeover', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT author_id FROM content WHERE id=? AND type=? AND site_id=1').bind(id, typeOf(kindOf(c))).first<{ author_id: number | null }>();
  if (!row) return errorPage(c, 404, 'Not found.');
  if (!can(c.var.user, 'edit_others_posts')) return errorPage(c, 403, 'Your role cannot take over an edit.');
  await claimLock(c.env, id, c.var.user, true);
  return go(c, `/${kindOf(c)}/${id}`, { ok: 'You have the edit now. The other person will be warned when they save.' });
});

content.get('/:kind{(?:pages|posts)}/new', (c) => editor(c, kindOf(c), null));

content.get('/:kind{(?:pages|posts)}/:id{[0-9]+}', async (c) => {
  const kind = kindOf(c);
  const row = await c.env.DB.prepare('SELECT * FROM content WHERE id=? AND type=? AND site_id=1').bind(Number(c.req.param('id')), typeOf(kind)).first<ContentRow>();
  if (!row) return errorPage(c, 404, 'Not found.');
  if (!mayEdit(c, row)) return errorPage(c, 403, 'You can only edit your own posts.');
  return editor(c, kind, row);
});

/* -------------------------------------------------------------------- save */
content.post('/:kind{(?:pages|posts)}/save', async (c) => {
  const kind = kindOf(c);
  const type = typeOf(kind);
  const f = c.var.form;
  const str = (k: string) => String(f.get(k) ?? '');
  const db = c.env.DB;
  const id = Number(str('id')) || 0;
  const now = new Date().toISOString();

  let existing: ContentRow | null = null;
  if (id) {
    existing = await db.prepare('SELECT * FROM content WHERE id=? AND type=? AND site_id=1').bind(id, type).first<ContentRow>();
    if (!existing) return errorPage(c, 404, 'Not found.');
    if (!mayEdit(c, existing)) return errorPage(c, 403, 'You can only edit your own posts.');
  }

  const title = str('title').trim().slice(0, 200) || '(untitled)';
  let slug = slugify(str('slug') || title) || `${type}-${Date.now().toString(36)}`;
  if (RESERVED_SLUGS.includes(slug) || slug === c.var.cfg.adminSlug) slug += '-' + type;
  // keep slugs unique per type: my-post, my-post-2, my-post-3 ...
  const root = slug;
  for (let n = 2; await db.prepare('SELECT 1 AS x FROM content WHERE site_id=1 AND type=? AND slug=? AND id<>?').bind(type, slug, id).first(); n++) {
    slug = `${root}-${n}`;
  }

  // Raw HTML is an admin privilege; everyone else goes through the allow-list sanitizer.
  const body = can(c.var.user, 'manage_settings') ? str('body') : sanitizeHtml(str('body'));

  let status = ['draft', 'published', 'scheduled'].includes(str('status')) ? str('status') : 'draft';
  if (type === 'page' && status === 'scheduled') status = 'published';
  const settings = await getSettings(c.env);
  const chosen = type === 'post' && str('publish_at') ? localToUtc(str('publish_at'), settings.timezone || 'UTC') : null;
  let publishedAt = chosen ?? existing?.published_at ?? null;
  if (status === 'scheduled') {
    if (!chosen) return go(c, id ? `/${kind}/${id}` : `/${kind}/new`, { err: 'Pick a publish date to schedule this post.' });
    if (chosen <= now) status = 'published';
  } else if (status === 'published') {
    if (!publishedAt || publishedAt > now) publishedAt = now;
  }

  const featuredRaw = Number(str('featured_media_id')) || 0;
  const featured = type === 'post' && featuredRaw && (await db.prepare('SELECT 1 AS x FROM media WHERE id=? AND site_id=1').bind(featuredRaw).first()) ? featuredRaw : null;
  const excerpt = type === 'post' ? str('excerpt').trim().slice(0, 500) : '';
  const seoTitle = str('seo_title').trim().slice(0, 200);
  const seoDesc = str('seo_description').trim().slice(0, 320);
  // A per-page template: only a template the active theme really has, else ''.
  const wantedTemplate = str('template').trim().slice(0, 40);
  const template = wantedTemplate && (await activeThemeTemplates(c.env)).templates.includes(wantedTemplate) ? wantedTemplate : '';

  // Snapshot the pre-save state first: this is what makes a save reversible.
  // Skipped when nothing a person can see has changed (a re-save of the same
  // form), so the history stays meaningful instead of filling with duplicates.
  if (existing) {
    const next = { title, slug, body, excerpt, seo_title: seoTitle, seo_description: seoDesc, status };
    const previous = { ...existing, seo_title: existing.seo_title, seo_description: existing.seo_description };
    if (!sameContent(previous, next)) await recordRevision(c.env, existing, { note: '', authorId: c.var.user.id });
  }

  let savedId = id;
  const trackEditor = await hasColumn(c.env, 'content', 'updated_by');
  if (existing) {
    await db.prepare(`UPDATE content SET title=?, slug=?, body=?, excerpt=?, status=?, seo_title=?, seo_description=?, featured_media_id=?, published_at=?, template=?, updated_at=?${trackEditor ? ', updated_by=?' : ''} WHERE id=?`)
      .bind(title, slug, body, excerpt, status, seoTitle, seoDesc, featured, publishedAt, template, now, ...(trackEditor ? [c.var.user.id] : []), id).run();
  } else {
    // 13 columns plus the optional updated_by; the placeholder count has to match
    // exactly, and SQLite will not tell you which one is missing.
    const columns = 'site_id,type,title,slug,body,excerpt,status,seo_title,seo_description,featured_media_id,author_id,published_at,template,created_at,updated_at'
      + (trackEditor ? ',updated_by' : '');
    const placeholders = '1,' + Array.from({ length: 14 }, () => '?').join(',') + (trackEditor ? ',?' : '');
    const res = await db.prepare(`INSERT INTO content (${columns}) VALUES (${placeholders})`)
      .bind(type, title, slug, body, excerpt, status, seoTitle, seoDesc, featured, c.var.user.id, publishedAt, template, now, now, ...(trackEditor ? [c.var.user.id] : [])).run();
    savedId = Number(res.meta.last_row_id);
  }
  if (existing) await pruneRevisions(c.env, savedId);
  // A real save ends the editing session for everyone, including this author.
  await releaseLock(c.env, savedId, c.var.user.id);

  if (type === 'post') {
    const names = (v: string) => [...new Set(v.split(',').map((s) => s.trim().slice(0, 60)).filter(Boolean))];
    const wanted: { taxonomy: string; name: string; slug: string }[] = [
      ...names(str('new_cats')).map((name) => ({ taxonomy: 'category', name, slug: slugify(name) })),
      ...names(str('tags')).map((name) => ({ taxonomy: 'tag', name, slug: slugify(name) })),
    ].filter((t) => t.slug);
    const catIds = f.getAll('cat').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
    const stmts = [
      db.prepare('DELETE FROM content_terms WHERE content_id=?').bind(savedId),
      ...wanted.map((t) => db.prepare('INSERT OR IGNORE INTO terms (site_id,taxonomy,name,slug) VALUES (1,?,?,?)').bind(t.taxonomy, t.name, t.slug)),
      ...wanted.map((t) => db.prepare('INSERT OR IGNORE INTO content_terms (content_id,term_id) SELECT ?, id FROM terms WHERE site_id=1 AND taxonomy=? AND slug=?').bind(savedId, t.taxonomy, t.slug)),
      ...catIds.map((tid) => db.prepare("INSERT OR IGNORE INTO content_terms (content_id,term_id) SELECT ?, id FROM terms WHERE id=? AND site_id=1 AND taxonomy='category'").bind(savedId, tid)),
      // drop tags nobody uses any more
      db.prepare("DELETE FROM terms WHERE taxonomy='tag' AND id NOT IN (SELECT term_id FROM content_terms)"),
    ];
    await db.batch(stmts);
  }

  if (type === 'page') {
    const isHome = settings.home_page_id === String(savedId);
    await syncPageMenu(c.env, {
      oldUrl: existing ? (isHome ? '/' : '/' + existing.slug) : null,
      url: isHome ? '/' : '/' + slug,
      label: title,
      show: str('in_menu') === '1' && status === 'published',
    });
  }

  await bumpCache(c.env, c.var.cfg);
  // One line per real save, saying what changed and where it is.
  await audit(c, existing ? (status === 'published' ? 'published' : 'updated') : 'created', 'content',
    `${existing ? 'Saved' : 'Created'} ${typeOf(kind).replace('page', 'page')} “${title || '(untitled)'}” (${status})`, savedId);
  return go(c, `/${kind}/${savedId}`, { ok: status === 'scheduled' ? 'Saved and scheduled.' : status === 'published' ? 'Saved and published.' : 'Draft saved.' });
});

/* ------------------------------------------------------------------ delete */
content.post('/:kind{(?:pages|posts)}/:id{[0-9]+}/delete', async (c) => {
  const kind = kindOf(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT id, slug, author_id FROM content WHERE id=? AND type=? AND site_id=1').bind(id, typeOf(kind)).first<{ id: number; slug: string; author_id: number | null }>();
  if (!row) return errorPage(c, 404, 'Not found.');
  if (!mayEdit(c, row)) return errorPage(c, 403, 'You can only delete your own posts.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM content_terms WHERE content_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM content_lock WHERE content_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM comments WHERE content_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM content WHERE id=?').bind(id),
    c.env.DB.prepare("DELETE FROM settings WHERE site_id=1 AND key='home_page_id' AND value=?").bind(String(id)),
  ]);
  await deleteRevisions(c.env, id);
  if (kind === 'pages') await removeUrlFromMenus(c.env, '/' + row.slug);
  await bumpCache(c.env, c.var.cfg);
  await audit(c, 'deleted', 'content', `Deleted ${typeOf(kind)} /${row.slug}`, id);
  return go(c, `/${kind}`, { ok: 'Deleted.' });
});

export default content;
