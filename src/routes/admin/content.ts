import { Hono } from 'hono';
import type { AppEnv, ContentRow, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { RESERVED_SLUGS, bumpCache, getSettings } from '../../lib/config';
import { mediaUrl, permalinkStyle, postUrl } from '../../lib/content';
import { sanitizeHtml, slugify } from '../../lib/security';
import { localToUtc, utcToLocal } from '../../lib/time';
import { isInPrimaryMenu, removeUrlFromMenus, syncPageMenu } from '../../lib/menus';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';

/** Pages and posts share one table and one editor; posts add terms, featured image and scheduling. */
const content = new Hono<AppEnv>();

type Kind = 'pages' | 'posts';
const typeOf = (kind: Kind) => (kind === 'pages' ? 'page' : 'post');
const kindOf = (c: Ctx): Kind => c.req.param('kind') as Kind;

// Pages need editor or above. Authors work on posts (their own only).
content.use('/:kind{(?:pages|posts)}/*', guard);
content.use('/:kind{(?:pages|posts)}', guard);
async function guard(c: Ctx, next: () => Promise<void>) {
  if (kindOf(c) === 'pages' && !can(c.var.user, 'editor')) return errorPage(c, 403, 'Your role cannot manage pages.');
  await next();
}
const mayEdit = (c: Ctx, row: { author_id: number | null }) => can(c.var.user, 'editor') || row.author_id === c.var.user.id;

type PostStatusFilter = 'all' | 'published' | 'draft' | 'scheduled';
type PostSort = 'title' | 'author' | 'comments' | 'date';
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
    sort: ['title', 'author', 'comments', 'date'].includes(rawSort) ? rawSort as PostSort : 'date',
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

async function postsList(c: Ctx): Promise<Response> {
  const state = postListState(c);
  const base = c.var.base;
  const settings = await getSettings(c.env);
  const timezone = settings.timezone || 'UTC';
  const authorOnly = !can(c.var.user, 'editor');
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
  };
  const direction = state.dir === 'asc' ? 'ASC' : 'DESC';
  const queryRows = (withComments: boolean) => c.env.DB.prepare(
    `SELECT c.id, c.title, c.slug, c.status, c.author_id, c.published_at, c.created_at, c.updated_at,
            u.username AS author,
            (SELECT group_concat(t.name, ', ') FROM content_terms ct JOIN terms t ON t.id=ct.term_id
             WHERE ct.content_id=c.id AND t.site_id=1 AND t.taxonomy='category') AS categories,
            (SELECT group_concat(t.name, ', ') FROM content_terms ct JOIN terms t ON t.id=ct.term_id
             WHERE ct.content_id=c.id AND t.site_id=1 AND t.taxonomy='tag') AS tags,
            ${withComments ? "(SELECT COUNT(*) FROM comments cm WHERE cm.site_id=1 AND cm.content_id=c.id AND cm.status IN ('approved','pending'))" : '0'} AS comment_count
     FROM content c LEFT JOIN users u ON u.id=c.author_id
     WHERE ${whereSql} ORDER BY ${sortSql[state.sort]} ${direction}, c.id DESC LIMIT ? OFFSET ?`,
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
  const currentUrl = postListHref(state);
  const bulkAction = `${base}/posts/bulk${currentUrl.slice('/posts'.length)}`;
  const selectedCategory = categories.results.find((term) => String(term.id) === state.category);
  const monthOptions = months.results.filter((row) => /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month));
  const categoryOptions = categories.results;
  const rangeStart = total ? (state.p - 1) * per + 1 : 0;
  const rangeEnd = Math.min((state.p - 1) * per + rows.length, total);
  const sortLink = (label: string, key: PostSort, defaultDir: 'asc' | 'desc' = 'asc') => {
    const nextDir = state.sort === key ? (state.dir === 'asc' ? 'desc' : 'asc') : defaultDir;
    const arrow = state.sort === key ? (state.dir === 'asc' ? '↑' : '↓') : '↕';
    return html`<a class="posts-sort${state.sort === key ? ' active' : ''}" href="${postListHref(state, { sort: key, dir: nextDir, p: 1 })}">${label}<span aria-hidden="true">${arrow}</span></a>`;
  };

  return layout(c, 'Posts', html`
<section class="posts-admin" aria-labelledby="posts-title">
  <form method="post" action="${bulkAction}" id="posts-bulk-form" class="posts-bulk-form">
    ${csrfField(c)}
  </form>
  <div class="posts-heading-row">
    <h1 id="posts-title">Posts</h1>
    <a class="btn ghost posts-add" href="${base}/posts/new">Add Post</a>
  </div>
  <nav class="posts-status-nav" aria-label="Post status filters">
    ${statusTabs.map(([key, label]) => html`<a href="${postListHref(state, { status: key, p: 1 })}" class="${state.status === key ? 'current' : ''}"${state.status === key ? raw(' aria-current="page"') : ''}>${label} <b>(${counts[key]})</b></a>`)}
  </nav>
  <div class="posts-search-row">
    <form method="get" action="${base}/posts" class="posts-search" role="search">
      <input type="hidden" name="status" value="${state.status}">
      ${state.month ? html`<input type="hidden" name="month" value="${state.month}">` : ''}
      ${state.category ? html`<input type="hidden" name="category" value="${state.category}">` : ''}
      ${state.sort !== 'date' ? html`<input type="hidden" name="sort" value="${state.sort}">` : ''}
      ${state.dir !== 'desc' ? html`<input type="hidden" name="dir" value="${state.dir}">` : ''}
      <label class="sr-only" for="post-search">Search posts</label>
      <input type="text" id="post-search" name="q" value="${state.q}" placeholder="Search posts…" maxlength="120">
      <button class="btn ghost small" type="submit">Search Posts</button>
    </form>
  </div>
  <div class="posts-controls-row">
    <div class="posts-bulk-control">
      <label class="sr-only" for="bulk-action-top">Bulk actions</label>
      <select id="bulk-action-top" name="action" form="posts-bulk-form">
        <option value="">Bulk actions</option><option value="publish">Publish</option><option value="draft">Move to draft</option><option value="delete">Delete permanently</option>
      </select>
      <button class="btn ghost small" type="submit" form="posts-bulk-form">Apply</button>
    </div>
    <form method="get" action="${base}/posts" class="post-filter-form">
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
        <option value="">All Categories</option>
        ${state.category && !selectedCategory ? html`<option value="${state.category}" selected>Selected category</option>` : ''}
        ${categoryOptions.map((term) => html`<option value="${term.id}"${state.category === String(term.id) ? raw(' selected') : ''}>${term.name}</option>`)}
      </select>
      <button class="btn ghost small" type="submit">Filter</button>
    </form>
  </div>
  <div class="posts-table-wrap">
    <table class="posts-table">
      <thead><tr>
        <th scope="col" class="posts-check-column"><input type="checkbox" id="select-all-posts" aria-label="Select all posts"></th>
        <th scope="col" aria-sort="${state.sort === 'title' ? state.dir === 'asc' ? 'ascending' : 'descending' : 'none'}">${sortLink('Title', 'title')}</th>
        <th scope="col" aria-sort="${state.sort === 'author' ? state.dir === 'asc' ? 'ascending' : 'descending' : 'none'}">${sortLink('Author', 'author')}</th>
        <th scope="col">Categories</th>
        <th scope="col">Tags</th>
        <th scope="col" class="posts-comments-column" aria-sort="${state.sort === 'comments' ? state.dir === 'asc' ? 'ascending' : 'descending' : 'none'}">${sortLink('Comments', 'comments', 'desc')}</th>
        <th scope="col" aria-sort="${state.sort === 'date' ? state.dir === 'asc' ? 'ascending' : 'descending' : 'none'}">${sortLink('Date', 'date', 'desc')}</th>
      </tr></thead>
      <tbody>
        ${rows.map((row) => {
          const url = postUrl(row, style);
          const date = row.status === 'published' ? row.published_at || row.created_at : row.status === 'scheduled' ? row.published_at || row.created_at : row.updated_at;
          const dateLabel = row.status === 'published' ? 'Published' : row.status === 'scheduled' ? 'Scheduled' : 'Last modified';
          const preview = url + (row.status === 'published' ? '' : '?preview=1');
          return html`<tr>
            <td class="posts-check-column"><input type="checkbox" name="ids" value="${row.id}" form="posts-bulk-form" aria-label="Select ${row.title}"></td>
            <td class="posts-title-cell">
              <a class="posts-title-link" href="${base}/posts/${row.id}">${row.title || '(untitled)'}</a>
              <div class="post-row-actions"><a href="${base}/posts/${row.id}">Edit</a><span aria-hidden="true">·</span><a href="${preview}" target="_blank" rel="noopener">View</a></div>
            </td>
            <td>${row.author || '—'}</td>
            <td>${row.categories || '—'}</td>
            <td>${row.tags || '—'}</td>
            <td class="posts-comments-column"><span class="post-comment-count" aria-label="${row.comment_count} comments">${row.comment_count}</span></td>
            <td class="posts-date-cell"><strong>${dateLabel}</strong><time datetime="${date}">${formatPostDate(date, timezone)}</time></td>
          </tr>`;
        })}
        ${rows.length ? '' : html`<tr><td colspan="7" class="posts-empty">No posts found. ${state.q || state.month || state.category || state.status !== 'all' ? 'Try changing your search or filters.' : html`Start by adding your first post.`}</td></tr>`}
      </tbody>
    </table>
  </div>
  <div class="posts-table-footer">
    <div class="posts-bulk-control">
      <label class="sr-only" for="bulk-action-bottom">Bulk actions</label>
      <select id="bulk-action-bottom">
        <option value="">Bulk actions</option><option value="publish">Publish</option><option value="draft">Move to draft</option><option value="delete">Delete permanently</option>
      </select>
      <button class="btn ghost small" type="submit" form="posts-bulk-form">Apply</button>
    </div>
    <span class="posts-count">${total ? `Showing ${rangeStart}–${rangeEnd} of ${total} posts` : '0 posts'}</span>
  </div>
  <div class="posts-pagination">
    ${state.p > 1 ? html`<a class="btn ghost small" href="${postListHref(state, { p: state.p - 1 })}">&larr; Newer</a>` : ''}
    ${total > state.p * per ? html`<a class="btn ghost small" href="${postListHref(state, { p: state.p + 1 })}">Older &rarr;</a>` : ''}
  </div>
  ${raw(`<script>
(function(){
  var top=document.getElementById('bulk-action-top'),bottom=document.getElementById('bulk-action-bottom');
  if(top&&bottom){top.addEventListener('change',function(){bottom.value=top.value});bottom.addEventListener('change',function(){top.value=bottom.value})}
  var all=document.getElementById('select-all-posts'),boxes=[].slice.call(document.querySelectorAll('input[name="ids"]'));
  function updateAll(){if(!all)return;var checked=boxes.filter(function(box){return box.checked}).length;all.checked=boxes.length>0&&checked===boxes.length;all.indeterminate=checked>0&&checked<boxes.length}
  if(all){all.addEventListener('change',function(){boxes.forEach(function(box){box.checked=all.checked});updateAll()});boxes.forEach(function(box){box.addEventListener('change',updateAll)})}
  var form=document.getElementById('posts-bulk-form');if(form)form.addEventListener('submit',function(e){
    if(top&&top.value==='delete'&&!confirm('Permanently delete the selected posts? This cannot be undone.'))e.preventDefault();
  });
})();
</script>`)}
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
    sort: ['title', 'author', 'comments', 'date'].includes(rawSort) ? rawSort as PostSort : 'date',
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
  };
  const queryRows = (withComments: boolean) => c.env.DB.prepare(
    `SELECT c.id, c.title, c.slug, c.status, c.published_at, c.created_at, c.updated_at, u.username AS author,
            ${withComments ? "(SELECT COUNT(*) FROM comments cm WHERE cm.site_id=1 AND cm.content_id=c.id AND cm.status IN ('approved','pending'))" : '0'} AS comment_count
     FROM content c LEFT JOIN users u ON u.id=c.author_id
     WHERE ${whereSql} ORDER BY ${sortSql[state.sort]} ${direction}, c.id DESC LIMIT ? OFFSET ?`,
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
  const currentUrl = pageListHref(state);
  const bulkAction = `${base}/pages/bulk${currentUrl.slice('/pages'.length)}`;
  const monthOptions = months.results.filter((row) => /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month));
  const rangeStart = total ? (state.p - 1) * per + 1 : 0;
  const rangeEnd = Math.min((state.p - 1) * per + rows.length, total);
  const sortLink = (label: string, key: PostSort, defaultDir: 'asc' | 'desc' = 'asc') => {
    const nextDir = state.sort === key ? (state.dir === 'asc' ? 'desc' : 'asc') : defaultDir;
    const arrow = state.sort === key ? (state.dir === 'asc' ? '↑' : '↓') : '↕';
    return html`<a class="posts-sort${state.sort === key ? ' active' : ''}" href="${pageListHref(state, { sort: key, dir: nextDir, p: 1 })}">${label}<span aria-hidden="true">${arrow}</span></a>`;
  };

  return layout(c, 'Pages', html`
<section class="posts-admin pages-admin" aria-labelledby="pages-title">
  <form method="post" action="${bulkAction}" id="pages-bulk-form" class="posts-bulk-form">${csrfField(c)}</form>
  <div class="posts-heading-row"><h1 id="pages-title">Pages</h1><a class="btn ghost posts-add" href="${base}/pages/new">Add Page</a></div>
  <nav class="posts-status-nav" aria-label="Page status filters">
    ${statusTabs.map(([key, label]) => html`<a href="${pageListHref(state, { status: key, p: 1 })}" class="${state.status === key ? 'current' : ''}"${state.status === key ? raw(' aria-current="page"') : ''}>${label} <b>(${counts[key]})</b></a>`)}
  </nav>
  <div class="posts-search-row">
    <form method="get" action="${base}/pages" class="posts-search" role="search">
      <input type="hidden" name="status" value="${state.status}">
      ${state.month ? html`<input type="hidden" name="month" value="${state.month}">` : ''}
      ${state.sort !== 'date' ? html`<input type="hidden" name="sort" value="${state.sort}">` : ''}
      ${state.dir !== 'desc' ? html`<input type="hidden" name="dir" value="${state.dir}">` : ''}
      <label class="sr-only" for="page-search">Search pages</label>
      <input type="text" id="page-search" name="q" value="${state.q}" placeholder="Search pages…" maxlength="120">
      <button class="btn ghost small" type="submit">Search Pages</button>
    </form>
  </div>
  <div class="posts-controls-row">
    <div class="posts-bulk-control">
      <label class="sr-only" for="pages-bulk-top">Bulk actions</label>
      <select id="pages-bulk-top" name="action" form="pages-bulk-form">
        <option value="">Bulk actions</option><option value="publish">Publish</option><option value="draft">Move to draft</option><option value="delete">Delete permanently</option>
      </select>
      <button class="btn ghost small" type="submit" form="pages-bulk-form">Apply</button>
    </div>
    <form method="get" action="${base}/pages" class="post-filter-form">
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
    </form>
  </div>
  <div class="posts-table-wrap pages-table-wrap"><table class="posts-table pages-table">
    <thead><tr>
      <th scope="col" class="posts-check-column"><input type="checkbox" id="select-all-pages" aria-label="Select all pages"></th>
      <th scope="col" aria-sort="${state.sort === 'title' ? state.dir === 'asc' ? 'ascending' : 'descending' : 'none'}">${sortLink('Title', 'title')}</th>
      <th scope="col" aria-sort="${state.sort === 'author' ? state.dir === 'asc' ? 'ascending' : 'descending' : 'none'}">${sortLink('Author', 'author')}</th>
      <th scope="col" class="posts-comments-column" aria-sort="${state.sort === 'comments' ? state.dir === 'asc' ? 'ascending' : 'descending' : 'none'}">${sortLink('Comments', 'comments', 'desc')}</th>
      <th scope="col" aria-sort="${state.sort === 'date' ? state.dir === 'asc' ? 'ascending' : 'descending' : 'none'}">${sortLink('Date', 'date', 'desc')}</th>
    </tr></thead>
    <tbody>
      ${rows.map((row) => {
        const url = settings.home_page_id === String(row.id) ? '/' : '/' + row.slug;
        const date = row.status === 'published' ? row.published_at || row.created_at : row.updated_at;
        const dateLabel = row.status === 'published' ? 'Published' : 'Last Modified';
        const preview = url + (row.status === 'published' ? '' : '?preview=1');
        return html`<tr>
          <td class="posts-check-column"><input type="checkbox" name="ids" value="${row.id}" form="pages-bulk-form" aria-label="Select ${row.title}"></td>
          <td class="posts-title-cell"><a class="posts-title-link" href="${base}/pages/${row.id}">${row.title || '(untitled)'}</a>${row.status === 'draft' ? html` <span class="page-draft-label">— Draft</span>` : ''}
            <div class="post-row-actions"><a href="${base}/pages/${row.id}">Edit</a><span aria-hidden="true">·</span><a href="${preview}" target="_blank" rel="noopener">View</a></div>
          </td>
          <td>${row.author || '—'}</td>
          <td class="posts-comments-column"><span class="post-comment-count" aria-label="${row.comment_count} comments">${row.comment_count}</span></td>
          <td class="posts-date-cell"><strong>${dateLabel}</strong><time datetime="${date}">${formatPostDate(date, timezone)}</time></td>
        </tr>`;
      })}
      ${rows.length ? '' : html`<tr><td colspan="5" class="posts-empty">No pages found. ${state.q || state.month || state.status !== 'all' ? 'Try changing your search or filters.' : html`Add a page to get started.`}</td></tr>`}
    </tbody>
  </table></div>
  <div class="posts-table-footer">
    <div class="posts-bulk-control"><label class="sr-only" for="pages-bulk-bottom">Bulk actions</label>
      <select id="pages-bulk-bottom"><option value="">Bulk actions</option><option value="publish">Publish</option><option value="draft">Move to draft</option><option value="delete">Delete permanently</option></select>
      <button class="btn ghost small" type="submit" form="pages-bulk-form">Apply</button>
    </div>
    <span class="posts-count">${total ? `Showing ${rangeStart}–${rangeEnd} of ${total} pages` : '0 pages'}</span>
  </div>
  <div class="posts-pagination">
    ${state.p > 1 ? html`<a class="btn ghost small" href="${pageListHref(state, { p: state.p - 1 })}">&larr; Newer</a>` : ''}
    ${total > state.p * per ? html`<a class="btn ghost small" href="${pageListHref(state, { p: state.p + 1 })}">Older &rarr;</a>` : ''}
  </div>
  ${raw(`<script>
(function(){
  var top=document.getElementById('pages-bulk-top'),bottom=document.getElementById('pages-bulk-bottom');
  if(top&&bottom){top.addEventListener('change',function(){bottom.value=top.value});bottom.addEventListener('change',function(){top.value=bottom.value})}
  var all=document.getElementById('select-all-pages'),boxes=[].slice.call(document.querySelectorAll('input[name="ids"][form="pages-bulk-form"]'));
  function updateAll(){if(!all)return;var checked=boxes.filter(function(box){return box.checked}).length;all.checked=boxes.length>0&&checked===boxes.length;all.indeterminate=checked>0&&checked<boxes.length}
  if(all){all.addEventListener('change',function(){boxes.forEach(function(box){box.checked=all.checked});updateAll()});boxes.forEach(function(box){box.addEventListener('change',updateAll)})}
  var form=document.getElementById('pages-bulk-form');if(form)form.addEventListener('submit',function(e){if(top&&top.value==='delete'&&!confirm('Permanently delete the selected pages? This cannot be undone.'))e.preventDefault()});
})();
</script>`)}
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

  const authorOnly = !can(c.var.user, 'editor');
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
const EDITOR_JS = `<script>
(function(){
  var ta=document.getElementById('body'),visual=document.getElementById('visual-editor');
  var mode='html',visualRange=null;
  var htmlDialog=document.getElementById('html-block-dialog'),youtubeDialog=document.getElementById('youtube-dialog');
  function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
  function rememberSelection(){
    var sel=window.getSelection();
    if(sel.rangeCount&&visual.contains(sel.anchorNode))visualRange=sel.getRangeAt(0).cloneRange();
  }
  function restoreSelection(){
    visual.focus();
    var sel=window.getSelection(),range=visualRange;
    if(!range||!visual.contains(range.commonAncestorContainer)){range=document.createRange();range.selectNodeContents(visual);range.collapse(false)}
    sel.removeAllRanges();sel.addRange(range);
  }
  function insertSnippet(snippet){
    if(mode==='html'){
      var s=ta.selectionStart,e=ta.selectionEnd,v=ta.value;
      ta.value=v.slice(0,s)+snippet+v.slice(e);ta.focus();ta.selectionStart=ta.selectionEnd=s+snippet.length;
    }else{
      restoreSelection();document.execCommand('insertHTML',false,snippet);rememberSelection();
    }
  }
  function setMode(next){
    if(next===mode)return;
    if(next==='html'){ta.value=visual.innerHTML;visual.hidden=true;ta.hidden=false;ta.focus()}
    else{visual.innerHTML=ta.value;ta.hidden=true;visual.hidden=false;visual.focus();restoreSelection()}
    mode=next;
    document.querySelectorAll('[data-editor-mode]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.editorMode===next))});
  }
  document.querySelectorAll('[data-editor-mode]').forEach(function(b){b.addEventListener('click',function(){setMode(b.dataset.editorMode)})});
  visual.addEventListener('keyup',rememberSelection);visual.addEventListener('mouseup',rememberSelection);
  visual.addEventListener('paste',function(e){
    e.preventDefault();var text=(e.clipboardData||window.clipboardData).getData('text/plain');
    document.execCommand('insertText',false,text);
  });
  document.querySelectorAll('[data-wrap]').forEach(function(b){
    b.addEventListener('mousedown',function(e){if(mode==='text')e.preventDefault()});
    b.addEventListener('click',function(){
      if(mode==='text')rememberSelection();
      var parts=b.getAttribute('data-wrap').split('|'),open=parts[0],close=parts[1]||'';
      if(b.dataset.ask){var u=prompt(b.dataset.ask,b.dataset.def||'');if(!u)return;open=open.replace('$1',escapeHtml(u))}
      if(mode==='text'){
        restoreSelection();
        if(b.dataset.command){document.execCommand(b.dataset.command,false,b.dataset.value||null)}
        else{
          var sel=window.getSelection(),selected='';
          if(sel.rangeCount){var holder=document.createElement('div');holder.appendChild(sel.getRangeAt(0).cloneContents());selected=holder.innerHTML}
          document.execCommand('insertHTML',false,open+selected+close);
        }
        rememberSelection();
      }else{
        var s=ta.selectionStart,e=ta.selectionEnd,v=ta.value;
        ta.value=v.slice(0,s)+open+v.slice(s,e)+close+v.slice(e);ta.focus();ta.selectionStart=s+open.length;ta.selectionEnd=e+open.length;
      }
    })
  });
  function openDialog(dialog,focus){
    rememberSelection();dialog.showModal();setTimeout(function(){focus.focus()},0);
  }
  document.querySelectorAll('[data-close-dialog]').forEach(function(b){b.addEventListener('click',function(){b.closest('dialog').close()})});
  document.getElementById('add-html-block').addEventListener('click',function(){openDialog(htmlDialog,document.getElementById('html-block-input'))});
  document.getElementById('insert-html-block').addEventListener('click',function(){
    var input=document.getElementById('html-block-input'),code=input.value.trim();if(!code){input.focus();return}
    insertSnippet('<div class="html-block">\n'+code+'\n</div>');input.value='';htmlDialog.close();
  });
  function youtubeId(value){
    try{
      var url=new URL(value),host=url.hostname.toLowerCase().replace(/^(www|m)\./,''),id='';
      if(url.protocol!=='https:'&&url.protocol!=='http:')return '';
      if(host==='youtu.be')id=url.pathname.split('/')[1];
      else if(host==='youtube.com'||host==='youtube-nocookie.com'){
        if(url.pathname==='/watch')id=url.searchParams.get('v')||'';
        else{var parts=url.pathname.split('/');if(['embed','shorts','live'].indexOf(parts[1])!==-1)id=parts[2]}
      }else return '';
      return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:'';
    }catch(e){return ''}
  }
  document.getElementById('add-youtube').addEventListener('click',function(){
    document.getElementById('youtube-error').hidden=true;openDialog(youtubeDialog,document.getElementById('youtube-url'));
  });
  document.getElementById('insert-youtube').addEventListener('click',function(){
    var input=document.getElementById('youtube-url'),id=youtubeId(input.value.trim()),error=document.getElementById('youtube-error');
    if(!id){error.hidden=false;input.focus();return}
    var title=document.getElementById('youtube-title').value.trim()||'YouTube video player';
    var embed='<figure class="video-block youtube-video"><div class="video-responsive"><iframe src="https://www.youtube-nocookie.com/embed/'+id+'" title="'+escapeHtml(title)+'" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div></figure>';
    insertSnippet(embed);input.value='';document.getElementById('youtube-title').value='';youtubeDialog.close();
  });
  ['youtube-url','youtube-title','html-block-input'].forEach(function(id){document.getElementById(id).addEventListener('keydown',function(e){
    if(e.key==='Enter'&&(id!=='html-block-input'||e.ctrlKey||e.metaKey)){e.preventDefault();document.getElementById(id==='html-block-input'?'insert-html-block':'insert-youtube').click()}
  })});
  document.getElementById('edit').addEventListener('submit',function(){if(mode==='text')ta.value=visual.innerHTML});
  // Text is the friendly visual editor; HTML mode always exposes the same underlying markup.
  visual.innerHTML=ta.value;setMode('text');
  var title=document.getElementById('title'),slug=document.getElementById('slug');
  if(slug&&!slug.value){title.addEventListener('input',function(){if(slug.dataset.touched)return;
    slug.value=title.value.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)});
    slug.addEventListener('input',function(){slug.dataset.touched=1})}
  var st=document.getElementById('status'),when=document.getElementById('when');
  if(st&&when){var sync=function(){when.hidden=st.value==='draft'};st.addEventListener('change',sync);sync()}
  var del=document.getElementById('delete');if(del)del.addEventListener('submit',function(e){if(!confirm('Delete this permanently?'))e.preventDefault()});
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
      c.env.DB.prepare("SELECT id, filename, r2_key FROM media WHERE site_id=1 AND mime LIKE 'image/%' ORDER BY id DESC LIMIT 200").all<{ id: number; filename: string; r2_key: string }>(),
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
  <label for="featured">Featured image</label>
  <select id="featured" name="featured_media_id">
    <option value="">None</option>
    ${images.results.map((i) => html`<option value="${i.id}"${i.id === row?.featured_media_id ? raw(' selected') : ''}>${i.filename}</option>`)}
  </select>
  ${featured ? html`<p><img src="${mediaUrl(featured.r2_key)}" alt="" style="max-width:12rem;border-radius:.5rem"></p>` : ''}
  <p class="hint">Upload images in <a href="${base}/media">Media</a> first.</p>
</div>`;
  }

  const status = row?.status ?? 'draft';
  // Pages: one tick puts the page in the header menu (new pages and drafts start ticked).
  const pageUrl = row ? (settings.home_page_id === String(row.id) ? '/' : '/' + row.slug) : null;
  const inMenu = type === 'page' && (!row || row.status === 'draft' || (await isInPrimaryMenu(c.env, pageUrl!)));
  const opt = (v: string, label: string) => html`<option value="${v}"${status === v ? raw(' selected') : ''}>${label}</option>`;
  const title = row ? `Edit ${type}` : `New ${type}`;
  return layout(c, title, html`
<div class="row between" style="margin-bottom:1rem"><h1 style="margin:0">${title}</h1><a href="${base}/${kind}">&larr; All ${kind}</a></div>
<form method="post" action="${base}/${kind}/save" id="edit">
  ${csrfField(c)}
  <input type="hidden" name="id" value="${row?.id ?? ''}">
  <div class="card">
    <label for="title" style="margin-top:0">Title</label>
    <input type="text" id="title" name="title" value="${row?.title ?? ''}" required maxlength="200">
    <label for="slug">Slug</label>
    <input type="text" id="slug" name="slug" value="${row?.slug ?? ''}" maxlength="80" autocapitalize="none" placeholder="generated from the title">
    <div class="editor-heading row between">
      <label for="body" id="content-label">Content</label>
      <div class="editor-modes" role="group" aria-label="Editor mode">
        <button type="button" data-editor-mode="text" aria-pressed="false">Text</button>
        <button type="button" data-editor-mode="html" aria-pressed="true">HTML</button>
      </div>
    </div>
    <div class="toolbar" aria-label="Content formatting">
      <button type="button" data-wrap="<strong>|</strong>" data-command="bold" title="Bold"><b>B</b></button>
      <button type="button" data-wrap="<em>|</em>" data-command="italic" title="Italic"><i>I</i></button>
      <button type="button" data-wrap="<h2>|</h2>" data-command="formatBlock" data-value="h2">H2</button>
      <button type="button" data-wrap="<h3>|</h3>" data-command="formatBlock" data-value="h3">H3</button>
      <button type="button" data-wrap="<p>|</p>" data-command="formatBlock" data-value="p" title="Paragraph">&para;</button>
      <button type="button" data-wrap="<ul>&#10;  <li>|</li>&#10;</ul>" data-command="insertUnorderedList">List</button>
      <button type="button" data-wrap="<blockquote>|</blockquote>" data-command="formatBlock" data-value="blockquote">Quote</button>
      <button type="button" data-wrap="<pre><code>|</code></pre>">Code</button>
      <button type="button" data-wrap='<a href="$1">|</a>' data-ask="Link URL" data-def="https://">Link</button>
      <button type="button" data-wrap='<img src="$1" alt="">|' data-ask="Image URL (copy it from Media)" data-def="/media/">Image</button>
      <span class="toolbar-separator" aria-hidden="true"></span>
      <button type="button" id="add-html-block" title="Insert a custom HTML block">&lt;/&gt; HTML block</button>
      <button type="button" id="add-youtube" title="Embed a YouTube video">&#9654; YouTube</button>
    </div>
    <div id="visual-editor" class="visual-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="content-label" data-placeholder="Write your content here…" hidden></div>
    <textarea id="body" name="body" class="code" spellcheck="true">${row?.body ?? ''}</textarea>
    <p class="hint">Use Text for visual editing or HTML to edit the source. You can add as many HTML and YouTube blocks as you need.</p>
    ${can(c.var.user, 'admin') ? html`<p class="hint">Admin HTML is not sanitized when you save.</p>` : html`<p class="hint">Unsafe HTML is removed when you save. YouTube embeds added with the YouTube button are allowed.</p>`}
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
    <p class="row" style="margin:1.1rem 0 0"><button class="btn" type="submit">Save</button></p>
  </div>
</form>
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
${row ? html`<form method="post" action="${base}/${kind}/${row.id}/delete" id="delete">${csrfField(c)}<button class="btn danger" type="submit">Delete ${type}</button></form>` : ''}
${raw(EDITOR_JS)}`, '/' + kind);
}

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
  const body = can(c.var.user, 'admin') ? str('body') : sanitizeHtml(str('body'));

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

  let savedId = id;
  if (existing) {
    await db.prepare('UPDATE content SET title=?, slug=?, body=?, excerpt=?, status=?, seo_title=?, seo_description=?, featured_media_id=?, published_at=?, updated_at=? WHERE id=?')
      .bind(title, slug, body, excerpt, status, seoTitle, seoDesc, featured, publishedAt, now, id).run();
  } else {
    const res = await db.prepare('INSERT INTO content (site_id,type,title,slug,body,excerpt,status,seo_title,seo_description,featured_media_id,author_id,published_at,created_at,updated_at) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(type, title, slug, body, excerpt, status, seoTitle, seoDesc, featured, c.var.user.id, publishedAt, now, now).run();
    savedId = Number(res.meta.last_row_id);
  }

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
    c.env.DB.prepare('DELETE FROM comments WHERE content_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM content WHERE id=?').bind(id),
    c.env.DB.prepare("DELETE FROM settings WHERE site_id=1 AND key='home_page_id' AND value=?").bind(String(id)),
  ]);
  if (kind === 'pages') await removeUrlFromMenus(c.env, '/' + row.slug);
  await bumpCache(c.env, c.var.cfg);
  return go(c, `/${kind}`, { ok: 'Deleted.' });
});

export default content;
