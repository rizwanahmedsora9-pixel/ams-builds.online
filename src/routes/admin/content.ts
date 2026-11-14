import { Hono } from 'hono';
import type { AppEnv, ContentRow, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { RESERVED_SLUGS, bumpCache, getSettings } from '../../lib/config';
import { mediaUrl, permalinkStyle, postUrl } from '../../lib/content';
import { sanitizeHtml, slugify } from '../../lib/security';
import { localToUtc, utcToLocal } from '../../lib/time';
import { isInPrimaryMenu, removeUrlFromMenus, syncPageMenu } from '../../lib/menus';
import {
  breadcrumbs, bulkBar, card, emptyRow, listToolbar, notice, pageHead, pagination, table, tabs, LIST_JS,
} from '../../admin/components';
import { icon, PAGE_ICONS, pageIcons } from '../../admin/icons';
import { PICKER_JS, mediaPicker } from '../../admin/media-picker';
import {
  claimLock, countRevisions, deleteRevisions, getRevision, latestAutosave, listRevisions,
  pruneLocks, pruneRevisions, readLock, recordRevision, releaseLock, sameContent, type RevisionRow,
} from '../../admin/revisions';
import { hasColumn, hasPhase2Schema, hasTable } from '../../lib/schema';
import {
  comparePageOrder, MAX_PAGE_DEPTH, orderedPageTree, pageDepth, pageDescendants,
  pageSubtreeHeight, type PageHierarchyRow,
} from '../../lib/page-hierarchy';
import { activeThemeTemplates } from '../../lib/theme-store';
import { audit } from '../../lib/audit';
import { lockBanner, restoreBanner, revisionDiff, revisionList } from '../../admin/editor-views';
import { csrfField, errorPage, go, html, layout, raw, type Raw } from '../../lib/ui';
import { EDITOR_JS } from '../../admin/editor-js';
import { PYTHON_SAMPLES } from '../../admin/py-samples';
import { EDITOR_UTILS_JS } from '../../admin/editor-utils';

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
type PostSort = 'title' | 'author' | 'date' | 'order';
type PostListState = {
  status: PostStatusFilter;
  q: string;
  month: string;
  category: string;
  page: string;
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
  assigned_pages: string | null;
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
  const rawTargetPage = c.req.query('page') || '';
  const targetPageId = Number(rawTargetPage);
  return {
    status: ['all', 'published', 'draft', 'scheduled'].includes(rawStatus) ? rawStatus as PostStatusFilter : 'all',
    q: (c.req.query('q') || '').trim().slice(0, 120),
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : '',
    category: /^\d+$/.test(rawCategory) && Number.isSafeInteger(categoryId) && categoryId > 0 ? rawCategory : '',
    page: rawTargetPage === 'blog' || (/^\d+$/.test(rawTargetPage) && Number.isSafeInteger(targetPageId) && targetPageId > 0) ? rawTargetPage : '',
    sort: ['title', 'author', 'date', 'order'].includes(rawSort) ? rawSort as PostSort : 'date',
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
  if (next.page) params.set('page', next.page);
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

  const [statusRows, categories, months, hasPostPages, hasParentCol] = await Promise.all([
    c.env.DB.prepare(`SELECT status, COUNT(*) AS n FROM content WHERE site_id=1 AND type='post'${ownerSql} GROUP BY status`)
      .bind(...ownerArgs).all<{ status: string; n: number }>(),
    c.env.DB.prepare("SELECT id, name FROM terms WHERE site_id=1 AND taxonomy='category' ORDER BY name COLLATE NOCASE")
      .all<{ id: number; name: string }>(),
    c.env.DB.prepare(`SELECT DISTINCT substr(COALESCE(published_at,created_at),1,7) AS month
      FROM content WHERE site_id=1 AND type='post'${ownerSql} ORDER BY month DESC LIMIT 24`)
      .bind(...ownerArgs).all<{ month: string }>(),
    hasTable(c.env, 'content_pages'),
    hasColumn(c.env, 'content', 'parent_id'),
  ]);
  const allTargetPages = hasPostPages
    ? orderedPageTree((await c.env.DB.prepare(
      `SELECT id, title, slug, ${hasParentCol ? 'parent_id' : 'NULL AS parent_id'}, status, COALESCE(menu_order,0) AS menu_order
       FROM content WHERE site_id=1 AND type='page' ORDER BY COALESCE(menu_order,0), title COLLATE NOCASE LIMIT 500`,
    ).all<PageHierarchyRow>().catch(() => ({ results: [] as PageHierarchyRow[] }))).results)
    : [];

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
  if (state.page && hasPostPages) {
    if (state.page === 'blog') {
      where.push('NOT EXISTS (SELECT 1 FROM content_pages filter_cp WHERE filter_cp.content_id=c.id)');
    } else {
      where.push('EXISTS (SELECT 1 FROM content_pages filter_cp WHERE filter_cp.content_id=c.id AND filter_cp.page_id=?)');
      args.push(Number(state.page));
    }
  }
  const whereSql = where.join(' AND ');
  const sortSql: Record<PostSort, string> = {
    title: 'c.title COLLATE NOCASE',
    author: "COALESCE(u.username,'') COLLATE NOCASE",
    date: 'COALESCE(c.published_at,c.created_at)',
    order: 'c.menu_order',
  };
  const direction = state.dir === 'asc' ? 'ASC' : 'DESC';
  const queryRows = (withPostPages: boolean) => {
    const assignedPagesSql = withPostPages
      ? `(SELECT group_concat(p.title, ', ') FROM content_pages cp JOIN content p ON p.id=cp.page_id
          WHERE cp.content_id=c.id AND p.site_id=1 AND p.type='page')`
      : 'NULL';
    return c.env.DB.prepare(
      `SELECT c.id, c.title, c.slug, c.status, c.author_id, c.published_at, c.created_at, c.updated_at,
              u.username AS author, c.pinned, m.r2_key AS thumb_key,
              (SELECT group_concat(t.name, ', ') FROM content_terms ct JOIN terms t ON t.id=ct.term_id
               WHERE ct.content_id=c.id AND t.site_id=1 AND t.taxonomy='category') AS categories,
              (SELECT group_concat(t.name, ', ') FROM content_terms ct JOIN terms t ON t.id=ct.term_id
               WHERE ct.content_id=c.id AND t.site_id=1 AND t.taxonomy='tag') AS tags,
              ${assignedPagesSql} AS assigned_pages
       FROM content c LEFT JOIN users u ON u.id=c.author_id LEFT JOIN media m ON m.id=c.featured_media_id
       WHERE ${whereSql} ORDER BY c.pinned DESC, ${sortSql[state.sort]} ${direction}, c.id DESC LIMIT ? OFFSET ?`,
    ).bind(...args, per + 1, (state.p - 1) * per).all<PostListRow>();
  };

  let listResult;
  try {
    listResult = await queryRows(hasPostPages);
  } catch (error) {
    // Older installations may be between schema migrations; fall back cleanly.
    const msg = String(error).toLowerCase();
    if (!msg.includes('content_pages')) throw error;
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
        page: state.page,
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
        ${hasPostPages && allTargetPages.length ? html`<label class="sr-only" for="post-page">Filter by page</label>
        <select id="post-page" name="page">
          <option value="">All placements</option>
          <option value="blog"${state.page === 'blog' ? raw(' selected') : ''}>Blog &amp; Home</option>
          ${allTargetPages.map(({ page, depth }) => html`<option value="${page.id}"${state.page === String(page.id) ? raw(' selected') : ''}>${'— '.repeat(depth)}${page.title}</option>`)}
        </select>` : ''}
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
                <span class="row-meta">${row.status !== 'published' ? html`<span class="badge ${row.status}">${row.status}</span>` : ''}${row.assigned_pages ? html`<span class="badge badge--outline">Page: ${row.assigned_pages}</span>` : ''}<span class="row-slug">/${row.slug}</span></span>
                ${rowActions(c, 'posts', row, preview, installedThemes)}
              </div>
            </div>`,
          row.author || '—',
          row.categories || '—',
          row.tags || '—',
          html`<span class="row-date"><strong>${dateLabel}</strong><time datetime="${date}">${formatPostDate(date, timezone)}</time></span>`,
        ];
      }),
    })
    : emptyRow(6, {
      title: 'No posts match',
      body: state.q || state.month || state.category || state.page || state.status !== 'all'
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
  pinned: number;
};

type AdminPageRow = PageHierarchyRow;

const PAGE_PARENT_JS = `<script>
(function(){
  var parent=document.getElementById('page-parent');
  var menu=document.querySelector('input[name="in_menu"]');
  if(parent&&menu)parent.addEventListener('change',function(){if(parent.value)menu.checked=false;});
})();
</script>`;

/** Server-rendered, keyboard-friendly tree for the Pages screen. */
function pageTreeMarkup(pages: AdminPageRow[], base: string, icons: { parent: string; child: string }): Raw {
  if (!pages.length) return html`<p class="muted" style="margin:0">No pages yet. Create a page to start the tree.</p>`;
  const byId = new Map(pages.map((page) => [page.id, page]));
  const byParent = new Map<number | null, AdminPageRow[]>();
  for (const page of pages) {
    const parent = page.parent_id != null && byId.has(page.parent_id) ? page.parent_id : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(page);
    byParent.set(parent, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort(comparePageOrder);
  const visited = new Set<number>();
  const render = (parentId: number | null): Raw => {
    const children = (byParent.get(parentId) ?? []).filter((page) => !visited.has(page.id));
    if (!children.length) return html``;
    return html`<ul class="page-tree__list">
      ${children.map((page) => {
        visited.add(page.id);
        const nested = render(page.id);
        const parent = page.parent_id == null ? null : byId.get(page.parent_id) ?? null;
        return html`<li class="page-tree__node">
          <div class="page-tree__row">
            <a href="${base}/pages/${page.id}">${icon(PAGE_ICONS.includes(page.icon as typeof PAGE_ICONS[number]) ? page.icon! : (byParent.get(page.id)?.length ? icons.parent : icons.child), { cls: 'ico--sm' })} ${page.title}</a>
            <span class="badge ${page.status}">${page.status}</span>
            ${parent ? html`<span class="page-tree__parent">Parent: ${parent.title}</span>` : ''}
          </div>
          ${nested}
        </li>`;
      })}
    </ul>`;
  };
  const tree = render(null);
  const unvisited = pages.filter((page) => !visited.has(page.id)).sort(comparePageOrder);
  return html`${tree}${unvisited.length ? html`<p class="hint">A broken or cyclic parent link was found. These pages are shown at the root so they remain editable.</p><ul class="page-tree__list">${unvisited.map((page) => html`<li class="page-tree__node"><div class="page-tree__row"><a href="${base}/pages/${page.id}">${icon(PAGE_ICONS.includes(page.icon as typeof PAGE_ICONS[number]) ? page.icon! : (byParent.get(page.id)?.length ? icons.parent : icons.child), { cls: 'ico--sm' })} ${page.title}</a><span class="badge ${page.status}">${page.status}</span></div></li>`)}</ul>` : ''}`;
}

function pageListState(c: Ctx): PageListState {
  const rawStatus = c.req.query('status') || 'all';
  const rawSort = c.req.query('sort') || 'date';
  const rawPage = Number(c.req.query('p')) || 1;
  const month = c.req.query('month') || '';
  return {
    status: ['all', 'published', 'draft'].includes(rawStatus) ? rawStatus as PageStatusFilter : 'all',
    q: (c.req.query('q') || '').trim().slice(0, 120),
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : '',
    sort: ['title', 'author', 'date', 'order'].includes(rawSort) ? rawSort as PostSort : 'date',
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
    date: 'COALESCE(c.published_at,c.created_at)',
    order: 'c.menu_order',
  };
  const queryRows = () => c.env.DB.prepare(
    `SELECT c.id, c.title, c.slug, c.status, c.published_at, c.created_at, c.updated_at, c.pinned, u.username AS author
     FROM content c LEFT JOIN users u ON u.id=c.author_id LEFT JOIN media m ON m.id=c.featured_media_id
     WHERE ${whereSql} ORDER BY c.pinned DESC, ${sortSql[state.sort]} ${direction}, c.id DESC LIMIT ? OFFSET ?`,
  ).bind(...args, per + 1, (state.p - 1) * per).all<PageListRow>();
  const listResult = await queryRows();
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM content c WHERE ${whereSql}`).bind(...args).first<{ n: number }>();
  const total = Number(totalRow?.n || 0);
  const rows = listResult.results.slice(0, per);
  const statusTabs: [PageStatusFilter, string][] = [['all', 'All'], ['published', 'Published'], ['draft', 'Draft']];
  const installedThemes = (await c.env.DB.prepare('SELECT slug, name FROM themes ORDER BY name').all<{ slug: string; name: string }>().catch(() => ({ results: [] as { slug: string; name: string }[] }))).results;
  const hasParentColumn = await hasColumn(c.env, 'content', 'parent_id');
  const hasIconColumn = await hasColumn(c.env, 'content', 'icon');
  const allPages = (await c.env.DB.prepare(
    `SELECT id, title, slug, status, ${hasIconColumn ? 'icon' : "'' AS icon"}, ${hasParentColumn ? 'parent_id' : 'NULL AS parent_id'}, COALESCE(menu_order,0) AS menu_order
     FROM content WHERE site_id=1 AND type='page' ORDER BY COALESCE(menu_order,0) ASC, title COLLATE NOCASE ASC LIMIT 500`,
  ).all<AdminPageRow>().catch(() => ({ results: [] as AdminPageRow[] }))).results;
  const hierarchyTree = pageTreeMarkup(allPages, base, pageIcons(await getSettings(c.env)));
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
  ${card({
    title: 'Page hierarchy',
    body: html`<p class="hint" style="margin-top:0">Set a <b>Parent page</b> in the editor to make a page a child. The tree is for organizing and browsing; turn off <b>Show in the main menu</b> on child pages to keep the header uncluttered. Published children are listed automatically on their parent page.</p>
      ${hasParentColumn ? hierarchyTree : html`<p class="notice">Run the database update to enable parent and child pages. <a href="${base}/updates">Open Updates</a>.</p>`}`,
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
          html`<span class="row-date"><strong>${dateLabel}</strong><time datetime="${date}">${formatPostDate(date, timezone)}</time></span>`,
        ];
      }),
    })
    : emptyRow(4, {
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
    if (await hasColumn(c.env, 'content', 'parent_id')) {
      await db.batch(rows.map((row) => db.prepare("UPDATE content SET parent_id=NULL WHERE site_id=1 AND type='page' AND parent_id=?").bind(row.id)));
    }
    const postPagesReady = await hasTable(c.env, 'content_pages');
    await db.batch(rows.flatMap((row) => [
      db.prepare('DELETE FROM content_terms WHERE content_id=?').bind(row.id),
      ...(postPagesReady ? [db.prepare('DELETE FROM content_pages WHERE page_id=?').bind(row.id)] : []),
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
    const postPagesReady = await hasTable(c.env, 'content_pages');
    const statements = validIds.flatMap((id) => [
      db.prepare('DELETE FROM content_terms WHERE content_id=?').bind(id),
      ...(postPagesReady ? [db.prepare('DELETE FROM content_pages WHERE content_id=?').bind(id)] : []),
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
/** A toolbar glyph: stroke-only on the sprite's 24px grid, coloured by the button. */
const tb = (paths: string): Raw => raw(`<svg class="tb-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`);

/**
 * Editor styles live here rather than in the shared ADMIN_CSS so the
 * classic/modern choice and the Text/HTML toggle look right on both skins.
 */
export const EDITOR_CSS = `<style>
.ams-editor{margin-bottom:.4rem}
.ams-editor-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:.45rem}
.ams-editor-switch{display:inline-flex;border:1px solid var(--line);border-radius:.45rem;overflow:hidden;background:var(--surface)}
.ams-editor-switch button{padding:.3rem .8rem;border:0;border-left:1px solid var(--line);background:var(--surface);color:var(--fg);font:inherit;font-size:.82rem;cursor:pointer;line-height:1.5;white-space:nowrap}
.ams-editor-switch button:first-child{border-left:0}
.ams-editor-switch button[aria-pressed=true]{background:var(--accent);color:var(--accent-fg)}
.ams-editor-bar .hint{margin:0;flex:1 1 12rem}
.ams-editor-pane[hidden]{display:none!important}
/* Formatting bar: icon buttons in labelled groups. It wraps by whole groups on
   a wide screen, becomes one swipeable row on a narrow one, and sticks under
   the top bar so the tools stay in reach in a long post. */
.ams-editor .toolbar{position:sticky;top:calc(var(--topbar-h) + .25rem);z-index:15;display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .1rem;margin-bottom:.4rem;box-shadow:var(--shadow-sm)}
.tb-group{display:flex;align-items:center;gap:.1rem;flex:0 0 auto;padding:0 .35rem;border-left:1px solid var(--line)}
.tb-group:first-child{padding-left:0;border-left:0}
.ams-editor .toolbar button{display:inline-flex;align-items:center;justify-content:center;gap:.35rem;flex:0 0 auto;min-width:2.25rem;height:2.25rem;padding:0 .5rem;border:1px solid transparent;border-radius:.4rem;background:transparent;color:var(--fg);font:inherit;font-size:.86rem;font-weight:600;line-height:1;white-space:nowrap;cursor:pointer;transition:background var(--dur-fast) var(--ease),color var(--dur-fast) var(--ease),transform var(--dur-fast) var(--ease)}
.ams-editor .toolbar button.tb-wide{font-weight:500;padding:0 .6rem}
.ams-editor .toolbar button:hover{background:var(--surface-2);color:var(--accent)}
.ams-editor .toolbar button:active{transform:scale(.94);background:var(--accent-soft)}
.ams-editor .toolbar button[disabled]{opacity:.4;cursor:default;pointer-events:none}
.tb-ico{width:1.15rem;height:1.15rem;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
/* Keep native text selection vivid inside both editor modes; the global
   selection colour is intentionally softer for ordinary page text. */
.ams-editor .visual-editor::selection,.ams-editor .visual-editor *::selection,.ams-editor textarea.code::selection{background:var(--accent);color:var(--accent-fg)}
.ams-editor .toolbar button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.ams-editor .toolbar button[aria-pressed=true]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
.toolbar-separator{width:1px;height:1.25rem;margin:0 .2rem;background:var(--line);align-self:center;flex:0 0 auto}
.ams-editor textarea.code,.ams-editor .visual-editor{min-height:22rem;margin:0;width:100%}
.ams-editor-status{margin:.35rem 0 0;color:var(--muted);font-size:.78rem;min-height:1.1em}
.ams-editor-stats{margin:0 0 0 auto;color:var(--muted);font-size:.78rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.slug-preview{margin:.15rem 0 .9rem;font-family:var(--mono-font,ui-monospace,monospace);overflow-wrap:anywhere}
/* Classic: compact WP-style chrome — small square buttons over a plain box.
   The bar stays visible: it holds the Classic/Modern switch itself, so hiding
   it (the old rule) stranded the user in Classic with no way back. */
.ams-editor.is-classic .ams-editor-bar{display:flex;margin-bottom:.3rem}
.ams-editor.is-classic .ams-editor-bar .hint{display:none}
.ams-editor.is-classic .ams-editor-stats{margin-left:auto}
.ams-editor.is-classic .ams-editor-switch button{padding:.2rem .55rem;font-size:.78rem}
.ams-editor.is-classic .toolbar{gap:.2rem .1rem;margin:0;padding:.3rem .35rem;border:1px solid var(--line);border-bottom:0;border-radius:.35rem .35rem 0 0;background:var(--bg)}
.ams-editor.is-classic .toolbar button{min-width:1.95rem;height:1.95rem;padding:0 .4rem;font-size:.8rem;border-radius:.25rem}
.ams-editor.is-classic .tb-label{display:none}
.ams-editor.is-classic textarea.code,.ams-editor.is-classic .visual-editor{border-radius:0 0 .35rem .35rem;min-height:24rem}
.ams-editor.is-classic .ams-editor-status{padding:0 .2rem}
/* Modern: roomy writing surface, a framed toolbar and generous spacing. */
.ams-editor.is-modern textarea.code,.ams-editor.is-modern .visual-editor{min-height:26rem;padding:1.1rem 1.2rem;font-size:1rem;line-height:1.7}
.ams-editor.is-modern .toolbar{padding:.4rem .5rem;border:1px solid var(--line);border-radius:.55rem;background:var(--bg)}
.ams-editor.is-modern textarea.code{font-size:.92rem;line-height:1.65}
.ams-mode-dialog .ams-mode-options{display:grid;gap:.5rem;margin:1rem 0}
.ams-mode-dialog .ams-mode-option{display:block;width:100%;padding:.75rem .85rem;border:1px solid var(--line);border-radius:.5rem;background:var(--surface);color:var(--fg);font:inherit;text-align:left;cursor:pointer}
.ams-mode-dialog .ams-mode-option:hover,.ams-mode-dialog .ams-mode-option:focus-visible{border-color:var(--accent);outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 25%,transparent)}
.ams-mode-dialog .ams-mode-option b{display:block;font-size:.95rem;margin:0 0 .2rem}
.ams-mode-dialog .ams-mode-option span{display:block;color:var(--muted);font-size:.82rem;font-weight:400}
.ams-mode-dialog .ams-mode-note{display:flex;align-items:center;gap:.5rem;font-weight:400;font-size:.85rem;color:var(--muted);margin:.2rem 0 0}
/* Images: inserted at a sane 50% (never full-bleed by default), click to select,
   then size with the bar, the % slider or by dragging a corner anchor. The width
   and alignment are saved as inline style/class, so the public page matches. */
.ams-editor{position:relative}
.visual-editor figure.image-block{margin:1em auto;max-width:100%}
.visual-editor figure.image-block img,.visual-editor img.is-selected{max-width:100%}
.visual-editor figure.image-block img{width:100%;height:auto;display:block}
.visual-editor figure.image-block figcaption{font-size:.85rem;color:var(--muted);text-align:center;padding:.35rem}
.visual-editor .align-left{float:left;margin:.3em 1em 1em 0}
.visual-editor figure.image-block.align-left{margin:.3em 1em 1em 0}
.visual-editor .align-right{float:right;margin:.3em 0 1em 1em}
.visual-editor figure.image-block.align-right{margin:.3em 0 1em 1em}
.visual-editor .align-center{margin-left:auto;margin-right:auto}
.visual-editor img.is-selected,.visual-editor figure.image-block.is-selected{outline:2px solid var(--accent);outline-offset:2px}
/* Page break: a marker the editor shows as a labelled rule. It carries no
   style attribute (the sanitizer only keeps width/align declarations), so the
   rule is drawn from the tag itself and the public page prints the break. */
.visual-editor hr.page-break{border:0;border-top:2px dashed var(--line-strong);margin:1.4rem 0;position:relative}
.visual-editor hr.page-break::after{content:'Page break';position:absolute;right:0;top:-.75em;padding:0 .4rem;background:var(--bg);color:var(--muted);font-size:.72rem;letter-spacing:.04em;text-transform:uppercase}
.visual-editor .html-block{border-color:var(--line-strong)}
.visual-editor:focus{outline:2px solid var(--accent);outline-offset:-1px}
.visual-editor.is-dropping{outline:2px dashed var(--accent);outline-offset:-2px;background:color-mix(in srgb,var(--accent) 6%,transparent)}
.ams-editor-drop{margin:.3rem 0 0;padding:.4rem .6rem;border:1px dashed var(--accent);border-radius:.35rem;color:var(--accent);font-size:.8rem}
.ams-editor-drop[hidden]{display:none!important}
/* The bar for a selected image or app floats beside the block instead of
   pushing the page down: nothing moves under the pointer when you click. */
.image-tools{position:absolute;z-index:32;left:0;top:0;display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .45rem;max-width:100%;margin:0;padding:.35rem .5rem;border:1px solid var(--line-strong);border-radius:.6rem;background:var(--surface);box-shadow:var(--shadow-lg);font-size:.8rem}
.image-tools[hidden]{display:none!important}
.image-tools b{margin-right:.1rem;font-size:.78rem}
.image-tools__set{display:inline-flex;border:1px solid var(--line);border-radius:.4rem;overflow:hidden}
/* The panel's global label style is a block with vertical margins; inside this
   bar it has to sit on the same line as the slider it belongs to. */
.image-tools label{display:inline-flex;align-items:center;gap:.35rem;margin:0;font-weight:400;white-space:nowrap}
.image-tools button{min-height:1.9rem;padding:0 .55rem;border:0;border-left:1px solid var(--line);background:var(--surface);color:var(--fg);font:inherit;font-size:.78rem;cursor:pointer;flex:0 0 auto;white-space:nowrap}
.image-tools__set button:first-child{border-left:0}
.image-tools button:hover{background:var(--surface-2);color:var(--accent)}
.image-tools button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.image-tools button[aria-pressed=true]{background:var(--accent);color:var(--accent-fg)}
.image-tools .image-tools__danger:hover{background:var(--danger-soft);color:var(--danger)}
.image-tools input[type=range]{width:6.5rem;accent-color:var(--accent)}
.image-tools input[type=number]{width:4.6rem;height:1.9rem;padding:0 .35rem;font-size:.8rem}
.image-tools output{min-width:3ch;font-variant-numeric:tabular-nums}
/* Resize frame: round anchors on the corners, pills on the sides, each with a
   touch-sized invisible hit area so a thumb or a fast mouse does not miss. */
.img-overlay{position:absolute;z-index:30;pointer-events:none;border:1.5px solid var(--accent);border-radius:2px;box-sizing:border-box}
.img-overlay[hidden]{display:none!important}
.img-overlay span{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border:2px solid var(--accent);border-radius:50%;background:var(--surface);box-shadow:var(--shadow-sm);pointer-events:auto;touch-action:none;transition:transform var(--dur-fast) var(--ease)}
.img-overlay span::after{content:'';position:absolute;inset:-10px}
.img-overlay span:hover,.is-resizing .img-overlay span{transform:scale(1.25);background:var(--accent)}
.img-overlay span[data-handle=nw]{left:0;top:0;cursor:nwse-resize}
.img-overlay span[data-handle=ne]{left:100%;top:0;cursor:nesw-resize}
.img-overlay span[data-handle=sw]{left:0;top:100%;cursor:nesw-resize}
.img-overlay span[data-handle=se]{left:100%;top:100%;cursor:nwse-resize}
.img-overlay span[data-handle=w],.img-overlay span[data-handle=e]{top:50%;width:8px;height:26px;margin:-13px 0 0 -4px;border-radius:4px;cursor:ew-resize}
.img-overlay span[data-handle=w]{left:0}
.img-overlay span[data-handle=e]{left:100%}
.img-overlay span[data-handle=s]{left:50%;top:100%;width:26px;height:8px;margin:-4px 0 0 -13px;border-radius:4px;cursor:ns-resize}
.img-overlay[data-kind=image] span[data-handle=s]{display:none}
.img-overlay__size{position:absolute;right:.4rem;bottom:.4rem;padding:.15rem .45rem;border-radius:.3rem;background:var(--fg);color:var(--bg);font-size:.72rem;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.img-overlay__size[hidden]{display:none}
/* While a handle is dragged nothing else may react: no text selection, no
   hover flicker, and the pointer keeps its resize shape off the handle. */
.ams-editor.is-resizing,.ams-editor.is-resizing *{user-select:none!important;-webkit-user-select:none!important}
.ams-editor.is-resizing .image-tools{opacity:0;pointer-events:none}
.ams-editor.is-resizing .visual-editor{pointer-events:none}
/* A Python app in the editor: a card with its file name and the first lines of
   its code. It is one block, selected and resized like an image. */
.visual-editor figure.python-app{display:flex;flex-direction:column;box-sizing:border-box;width:100%;max-width:100%;height:420px;margin:1em auto;border:1px solid var(--line-strong);border-radius:.55rem;overflow:hidden;background:var(--surface-2);cursor:pointer;user-select:none;-webkit-user-select:none}
.visual-editor figure.python-app::before{content:'Python app \\00B7  ' attr(title);flex:0 0 auto;padding:.5rem .75rem;border-bottom:1px solid var(--line);background:var(--surface);color:var(--fg);font-size:.8rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.visual-editor figure.python-app.python-app--manual::before{content:'Python app \\00B7  ' attr(title) ' \\00B7  starts on click'}
.visual-editor figure.python-app pre{flex:1 1 auto;min-height:0;margin:0;padding:.6rem .75rem;border:0;border-radius:0;overflow:hidden;background:none;color:var(--muted);font-family:var(--mono-font);font-size:.74rem;line-height:1.5;white-space:pre;pointer-events:none}
.visual-editor figure.python-app pre code{padding:0;background:none;color:inherit;font:inherit}
.visual-editor figure.python-app.align-left{margin:.3em 1em 1em 0}
.visual-editor figure.python-app.align-right{margin:.3em 0 1em 1em}
.visual-editor figure.python-app.is-selected{outline:2px solid var(--accent);outline-offset:2px}
/* Python dialog */
#python-dialog{width:min(40rem,94vw)}
.py-file{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem;margin:.6rem 0 .2rem}
.py-file span{min-width:0;overflow-wrap:anywhere}
.py-sample{display:inline-flex;align-items:center;gap:.4rem;min-width:0}
.py-sample select{min-height:2.2rem;max-width:16rem;padding:0 .5rem;border:1px solid var(--line-strong);border-radius:.4rem;background:var(--surface);color:var(--fg);font:inherit;font-size:.85rem}
.py-code{min-height:9rem;max-height:32vh;font-size:.8rem;line-height:1.5;white-space:pre;overflow:auto;tab-size:4}
.py-warnings{margin:.5rem 0 0;padding:.5rem .7rem .5rem 1.7rem;border:1px solid var(--warn);border-radius:.4rem;background:var(--warn-soft);font-size:.82rem}
.py-warnings[hidden]{display:none}
.py-area{margin:.9rem 0 0;padding:.6rem .8rem .8rem;border:1px solid var(--line);border-radius:.5rem;min-width:0}
.py-area legend{padding:0 .35rem;font-weight:600;font-size:.85rem}
.py-area__grid{display:grid;grid-template-columns:minmax(0,1fr) 7.5rem;gap:1rem;align-items:center}
.py-area__fields label{margin-top:.4rem}
.py-area__page{display:flex;flex-direction:column;align-items:center;gap:.3rem;height:7rem;padding:.5rem;border:1px solid var(--line);border-radius:.35rem;background:var(--bg);overflow:hidden}
.py-area__page span{flex:0 0 auto;width:100%;height:.3rem;border-radius:.2rem;background:var(--line)}
.py-area__page i{flex:0 0 auto;width:100%;height:2.8rem;border:1.5px solid var(--accent);border-radius:.2rem;background:var(--accent-soft)}
@media (max-width:820px){
  .ams-editor .toolbar,.ams-editor.is-classic .toolbar{flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;-webkit-overflow-scrolling:touch;top:var(--topbar-h)}
  .ams-editor .toolbar button{min-width:2.5rem;height:2.5rem}
  .tb-label{display:none}
  .image-tools{gap:.3rem}
  .image-tools input[type=range]{width:5rem}
  .py-area__grid{grid-template-columns:minmax(0,1fr)}
  .py-area__page{display:none}
}
@media (hover:none){.img-overlay span{width:16px;height:16px;margin:-8px 0 0 -8px}}
/* Link and image-block dialogs: the form beside the picture, so the writer
   sees what will be placed before it goes in. */
.image-block-form{display:grid;grid-template-columns:minmax(8rem,12rem) minmax(0,1fr);gap:1rem;align-items:start;margin:.5rem 0}
.image-block-form__preview{display:grid;place-items:center;min-height:6rem;border:1px dashed var(--line-strong);border-radius:.45rem;background:var(--surface-2);overflow:hidden}
.image-block-form__preview img{display:block;max-width:100%;max-height:10rem;height:auto}
.image-block-form__fields{display:grid;gap:.15rem}
.image-block-form__fields label{margin-top:.5rem}
.image-block-form__fields label:first-child{margin-top:0}
.image-block-form__width{margin:.2rem 0 0;gap:.5rem}
.image-block-form__width input[type=range]{flex:1;accent-color:var(--accent)}
.image-block-form__width output{min-width:3ch;font-variant-numeric:tabular-nums}
.dialog-grow{flex:1 1 auto}
dialog[open]{max-height:90vh;overflow:auto}
#link-dialog,#image-block-dialog{width:min(34rem,94vw)}
@media(max-width:640px){
  .image-block-form{grid-template-columns:1fr}
  .image-block-form__preview{min-height:5rem;max-height:8rem}
  /* Sticks under the panel's own top bar: at top:0 the bar slid underneath it
     and the Classic/Modern switch and word count were covered. */
  .ams-editor-bar{position:sticky;top:var(--topbar-h);z-index:5;background:var(--bg);padding:.25rem 0;border-bottom:1px solid var(--line)}
  .ams-editor .toolbar{overflow-x:auto;flex-wrap:nowrap;padding-bottom:.3rem}
  .ams-editor.is-modern .toolbar{flex-wrap:wrap}
}
</style>`;

/**
 * The client script for the editor: two skins (classic / modern), a
 * Text <-> HTML switch that keeps content, caret and scroll position, the
 * formatting bar, links, image blocks with size/alignment handles, the media
 * picker, autosave and the word counter. It lives in
 * src/admin/editor-js.ts so the tests can run exactly what ships.
 */

async function editor(c: Ctx, kind: Kind, row: ContentRow | null): Promise<Response> {
  const type = typeOf(kind);
  const base = c.var.base;
  const settings = await getSettings(c.env);
  const tz = settings.timezone || 'UTC';
  let postFields = html``;

  if (type === 'post') {
    const [terms, mine, images, hasPostPages, hasParentCol] = await Promise.all([
      c.env.DB.prepare('SELECT id, taxonomy, name FROM terms WHERE site_id=1 ORDER BY name').all<{ id: number; taxonomy: string; name: string }>(),
      row ? c.env.DB.prepare('SELECT term_id FROM content_terms WHERE content_id=?').bind(row.id).all<{ term_id: number }>() : null,
      c.env.DB.prepare("SELECT id, filename, r2_key, alt FROM media WHERE site_id=1 AND mime LIKE 'image/%' ORDER BY id DESC LIMIT 200").all<{ id: number; filename: string; r2_key: string; alt: string }>(),
      hasTable(c.env, 'content_pages'),
      hasColumn(c.env, 'content', 'parent_id'),
    ]);
    let postPagesReady = hasPostPages;
    const [allPages, myPages] = postPagesReady
      ? await Promise.all([
        c.env.DB.prepare(
          `SELECT id, title, slug, ${hasParentCol ? 'parent_id' : 'NULL AS parent_id'}, status, COALESCE(menu_order,0) AS menu_order
           FROM content WHERE site_id=1 AND type='page' ORDER BY COALESCE(menu_order,0), title COLLATE NOCASE LIMIT 500`,
        ).all<PageHierarchyRow>().catch(() => ({ results: [] as PageHierarchyRow[] })),
        row ? c.env.DB.prepare('SELECT page_id FROM content_pages WHERE content_id=?').bind(row.id).all<{ page_id: number }>().catch(() => { postPagesReady = false; return null; }) : null,
      ])
      : [{ results: [] as PageHierarchyRow[] }, null];
    const selected = new Set((mine?.results || []).map((t) => t.term_id));
    const selectedPages = new Set((myPages?.results || []).map((p) => p.page_id));
    const targetPageTree = orderedPageTree(allPages.results);
    const cats = terms.results.filter((t) => t.taxonomy === 'category');
    const tags = terms.results.filter((t) => t.taxonomy === 'tag' && selected.has(t.id)).map((t) => t.name).join(', ');
    const featured = images.results.find((i) => i.id === row?.featured_media_id);
    const postPagesField = !postPagesReady
      ? html`<label>Show on page(s) only</label>
        <p class="hint">Page-specific posts are available after the database update. <a href="${base}/updates">Run updates</a>.</p>`
      : targetPageTree.length
        ? html`<label>Show on page(s) only</label>
          <input type="hidden" name="page_ids_present" value="1">
          <div class="checks" id="post-pages-picker">
            ${targetPageTree.map(({ page, depth }) => html`<label class="check"><input type="checkbox" name="page_ids" value="${page.id}"${selectedPages.has(page.id) ? raw(' checked') : ''}> ${'— '.repeat(depth)}${page.title}${page.status === 'draft' ? ' (draft)' : ''}</label>`)}
          </div>
          <p class="hint">Tick one or more pages or sub-pages to display this post exclusively on those pages (hidden from the main blog, category/tag archives, RSS and Home latest posts). Leave all unchecked for a regular blog post.</p>`
        : html`<label>Show on page(s) only</label>
          <input type="hidden" name="page_ids_present" value="1">
          <p class="hint">No pages exist yet. Leave unchecked for the main blog, or <a href="${base}/pages/new">create a page</a> first.</p>`;
    postFields = html`
<div class="card">
  <h2>Post options</h2>
  ${postPagesField}
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
      <button class="btn ghost small" type="button" data-clear-featured${featured ? '' : raw(' hidden')}>Remove</button>
    </span>
  </div>
  <p class="hint">Picking from the library also lets you set alt text. Upload new images right in the dialog.</p>
</div>`;
  }

  let pageFields = html``;
  if (type === 'page') {
    const featured = row?.featured_media_id ? await c.env.DB.prepare("SELECT r2_key, alt FROM media WHERE id=? AND site_id=1 AND mime LIKE 'image/%'").bind(row.featured_media_id).first<{ r2_key: string; alt: string }>() : null;
    pageFields = html`<div class="card"><h2>Page card</h2>
      <label for="excerpt">Short description</label><textarea id="excerpt" name="excerpt" maxlength="500">${row?.excerpt ?? ''}</textarea>
      <p class="hint">Optional description shown on the parent page.</p>
      <label for="featured-id">Feature image</label><input type="hidden" id="featured-id" name="featured_media_id" value="${row?.featured_media_id ?? ''}">
      <div class="featured-picker"><span class="featured-picker__preview" data-featured-preview>${featured ? html`<img src="${mediaUrl(featured.r2_key)}" alt="${featured.alt || ''}">` : html`<span class="muted">No image chosen</span>`}</span>
      <span class="row"><button class="btn ghost small" type="button" data-open-picker="featured">Choose image</button><button class="btn ghost small" type="button" data-clear-featured${featured ? '' : raw(' hidden')}>Remove</button></span></div>
      <p class="hint">Optional. Choose an image from the library or upload one.</p></div>`;
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
  // `page` is not offered to a post (it would drop its date and author).
  const templateOptions = (await activeThemeTemplates(c.env)).templates
    .filter((t) => !['home', 'archive', '404', type, ...(type === 'post' ? ['page'] : [])].includes(t));
  const hierarchyAvailable = type === 'page' && await hasColumn(c.env, 'content', 'parent_id');
  const hierarchyPages = hierarchyAvailable
    ? (await c.env.DB.prepare(
      "SELECT id, title, slug, parent_id, status, COALESCE(menu_order,0) AS menu_order FROM content WHERE site_id=1 AND type='page' ORDER BY COALESCE(menu_order,0), title COLLATE NOCASE LIMIT 500",
    ).all<PageHierarchyRow>()).results
    : [];
  const hierarchyById = new Map(hierarchyPages.map((page) => [page.id, page]));
  const editorPageTrail: { label: string; href?: string }[] = [];
  if (type === 'page' && row) {
    const ancestors: PageHierarchyRow[] = [];
    const seen = new Set<number>([row.id]);
    let parent = row.parent_id;
    while (parent != null && !seen.has(parent) && ancestors.length < MAX_PAGE_DEPTH) {
      seen.add(parent);
      const ancestor = hierarchyById.get(parent);
      if (!ancestor) break;
      ancestors.unshift(ancestor);
      parent = ancestor.parent_id;
    }
    editorPageTrail.push({ label: 'Pages', href: `${base}/pages` });
    for (const ancestor of ancestors) editorPageTrail.push({ label: ancestor.title, href: `${base}/pages/${ancestor.id}` });
    editorPageTrail.push({ label: row.title });
  }

  const excludedParents = row ? pageDescendants(row.id, hierarchyPages) : new Set<number>();
  const movedSubtreeHeight = row ? pageSubtreeHeight(row.id, hierarchyPages) : 0;
  const parentOptions = orderedPageTree(hierarchyPages).filter(({ page }) =>
    !excludedParents.has(page.id) && pageDepth(page.id, hierarchyById) + 1 + movedSubtreeHeight <= MAX_PAGE_DEPTH,
  );
  const isHomePage = type === 'page' && !!row && settings.home_page_id === String(row.id);
  const pageParentField = type !== 'page' ? '' : !hierarchyAvailable
    ? html`<p class="hint">Parent and child pages are available after the database update. <a href="${base}/updates">Run updates</a>.</p>`
    : isHomePage
      ? html`<input type="hidden" name="parent_id" value=""><p class="hint">The site home page stays at the top level.</p>`
      : html`<label for="page-parent">Parent page</label>
        <select id="page-parent" name="parent_id">
          <option value="">No parent (top level)</option>
          ${parentOptions.map(({ page, depth }) => html`<option value="${page.id}"${String(row?.parent_id ?? '') === String(page.id) ? raw(' selected') : raw('')}>${'— '.repeat(depth)}${page.title}${page.status === 'draft' ? ' (draft)' : ''}</option>`)}
        </select>
        <p class="hint">A published parent page automatically lists its published children. Choosing a parent unchecks the main-menu option; child pages keep their own URLs.</p>`;
  // Pages: one tick puts the page in the header menu (new pages and drafts start ticked).
  const pageUrl = row ? (settings.home_page_id === String(row.id) ? '/' : '/' + row.slug) : null;
  const inMenu = type === 'page' && (!row || row.status === 'draft' || (await isInPrimaryMenu(c.env, pageUrl!)));
  const opt = (v: string, label: string) => html`<option value="${v}"${status === v ? raw(' selected') : ''}>${label}</option>`;
  const title = row ? `Edit ${type}` : `New ${type}`;
  // A post's address depends on the permalink style the site uses, so the
  // Preview link follows it instead of assuming /blog/.
  const rowUrl = row ? (type === 'post' ? postUrl(row, permalinkStyle(settings)) : settings.home_page_id === String(row.id) ? '/' : '/' + row.slug) : '';
  const rowPreview = row ? rowUrl + (row.status === 'published' ? '' : '?preview=1') : '';
  // Which editor opens: the site default, else the classic/modern chooser on Add New.
  const preferred = settings.default_editor === 'classic' || settings.default_editor === 'modern' ? settings.default_editor : '';
  const initialSkin = preferred || 'modern';
  return layout(c, title, html`
${raw(EDITOR_CSS)}
${editorPageTrail.length ? breadcrumbs(editorPageTrail) : ''}
<div class="row between editor-top" style="margin-bottom:1rem">
  <h1 style="margin:0">${title}</h1>
  <span class="row">
    ${row ? html`<a class="btn ghost small" href="${rowPreview}" target="_blank" rel="noopener">Preview</a>` : ''}
    <a class="btn ghost small" href="${base}/${kind}">&larr; All ${kind}</a>
  </span>
</div>
<div id="lock-slot">${lockHolder ? lockBanner(lockHolder, base, kind, row!.id, can(c.var.user, 'edit_others_posts')) : ''}</div>
${autosave ? restoreBanner(autosave, base, kind, row!.id) : ''}
<form method="post" action="${base}/${kind}/save" id="edit"
      data-is-new="${row ? '0' : '1'}" data-initial-skin="${initialSkin}" data-preferred-skin="${preferred}"
      data-autosave-url="${row ? `${base}/${kind}/${row.id}/autosave` : ''}"
      data-lock-url="${row ? `${base}/${kind}/${row.id}/lock` : ''}"
      data-picker-endpoint="${base}/media/picker"
      data-picker-upload="${base}/media/picker/upload"
      data-lock-mine="1" data-csrf="${c.var.csrf}"${row ? raw(` data-rowid="${row.id}"`) : ''}>
  ${csrfField(c)}
  <input type="hidden" name="id" value="${row?.id ?? ''}">
  <div class="card">
    <label for="title" style="margin-top:0">Title</label>
    <input type="text" id="title" name="title" value="${row?.title ?? ''}" required maxlength="200">
    <label for="slug">Slug</label>
    <input type="text" id="slug" name="slug" value="${row?.slug ?? ''}" maxlength="80" autocapitalize="none" placeholder="generated from the title" aria-describedby="slug-preview">
    <p class="hint slug-preview" id="slug-preview" aria-live="polite">${row?.slug || '…'}</p>
    <div class="editor-heading row between">
      <label for="body" id="content-label">Content</label>
      <div class="ams-editor-switch" id="editor-mode-switch" role="group" aria-label="Editor mode">
        <button type="button" data-editor-mode="text" aria-pressed="false" title="Visual editing">Text</button>
        <button type="button" data-editor-mode="html" aria-pressed="true" title="HTML source">HTML</button>
      </div>
    </div>
    <div class="ams-editor is-${initialSkin}" id="content-editor" data-skin="${initialSkin}">
      <div class="ams-editor-bar">
        <div class="ams-editor-switch" role="group" aria-label="Editor style">
          <button type="button" data-editor-skin-set="classic" aria-pressed="${initialSkin === 'classic' ? 'true' : 'false'}">Classic</button>
          <button type="button" data-editor-skin-set="modern" aria-pressed="${initialSkin === 'modern' ? 'true' : 'false'}">Modern</button>
        </div>
        <p class="hint">Classic shows the original toolbar; Modern keeps the same tools in a wider bar.</p>
        <p class="ams-editor-stats" id="editor-stats" aria-live="off"></p>
      </div>
      <div class="toolbar" id="editor-toolbar" role="toolbar" aria-label="Content formatting" aria-controls="visual-editor">
        <div class="tb-group" role="group" aria-label="History">
          <button type="button" data-exec="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${tb('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>')}</button>
          <button type="button" data-exec="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${tb('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>')}</button>
        </div>
        <div class="tb-group" role="group" aria-label="Text style">
          <button type="button" data-wrap="<strong>|</strong>" data-command="bold" title="Bold (Ctrl+B)" aria-label="Bold" aria-pressed="false"><b>B</b></button>
          <button type="button" data-wrap="<em>|</em>" data-command="italic" title="Italic (Ctrl+I)" aria-label="Italic" aria-pressed="false"><i>I</i></button>
          <button type="button" data-wrap="<u>|</u>" data-command="underline" title="Underline (Ctrl+U)" aria-label="Underline" aria-pressed="false"><u>U</u></button>
          <button type="button" data-wrap="<s>|</s>" data-command="strikeThrough" title="Strikethrough" aria-label="Strikethrough" aria-pressed="false"><s>S</s></button>
          <button type="button" data-exec="removeFormat" title="Clear formatting from the selection" aria-label="Clear formatting">${tb('<path d="M6 5h12"/><path d="M12 5 9 19"/><path d="m15 14 5 5M20 14l-5 5"/>')}</button>
        </div>
        <div class="tb-group" role="group" aria-label="Headings">
          <button type="button" data-wrap="<h2>|</h2>" data-command="formatBlock" data-value="h2" title="Heading 2" aria-pressed="false">H2</button>
          <button type="button" data-wrap="<h3>|</h3>" data-command="formatBlock" data-value="h3" title="Heading 3" aria-pressed="false">H3</button>
          <button type="button" data-wrap="<h4>|</h4>" data-command="formatBlock" data-value="h4" title="Heading 4" aria-pressed="false">H4</button>
          <button type="button" data-wrap="<p>|</p>" data-command="formatBlock" data-value="p" title="Paragraph" aria-label="Paragraph" aria-pressed="false">&para;</button>
        </div>
        <div class="tb-group" role="group" aria-label="Lists and blocks">
          <button type="button" data-wrap="<ul>&#10;  <li>|</li>&#10;</ul>" data-command="insertUnorderedList" title="Bulleted list" aria-label="Bulleted list" aria-pressed="false">${tb('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6v.01M4.5 12v.01M4.5 18v.01"/>')}</button>
          <button type="button" data-wrap="<ol>&#10;  <li>|</li>&#10;</ol>" data-command="insertOrderedList" title="Numbered list" aria-label="Numbered list" aria-pressed="false">${tb('<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5h1.5v4M4 9h3M4 14.5h2.5L4 18h3"/>')}</button>
          <button type="button" data-wrap="<blockquote>|</blockquote>" data-command="formatBlock" data-value="blockquote" title="Quote" aria-label="Quote" aria-pressed="false">${tb('<path d="M5 17c2.5-1 3.5-3 3.5-5.5V7H4v5h3"/><path d="M14 17c2.5-1 3.5-3 3.5-5.5V7H13v5h3"/>')}</button>
          <button type="button" data-wrap="<pre><code>|</code></pre>" title="Code block" aria-label="Code block">${tb('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>')}</button>
          <button type="button" data-wrap="<hr>|" data-command="insertHorizontalRule" title="Divider line" aria-label="Divider">${tb('<path d="M4 12h16"/><path d="M8 7h8M8 17h8" opacity=".45"/>')}</button>
        </div>
        <div class="tb-group" role="group" aria-label="Text alignment">
          <button type="button" data-exec="justifyLeft" title="Align text left" aria-label="Align text left">${tb('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>')}</button>
          <button type="button" data-exec="justifyCenter" title="Center text" aria-label="Center text">${tb('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>')}</button>
          <button type="button" data-exec="justifyRight" title="Align text right" aria-label="Align text right">${tb('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>')}</button>
          <button type="button" data-exec="justifyFull" title="Justify text" aria-label="Justify text">${tb('<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>')}</button>
        </div>
        <div class="tb-group tb-group--insert" role="group" aria-label="Insert">
          <button type="button" class="tb-wide" data-link-open title="Add or edit a link (Ctrl+Shift+K)" aria-pressed="false">${tb('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>')}<span class="tb-label">Link</span></button>
          <button type="button" class="tb-wide" data-picker-image id="insert-image" title="Insert an image from the media library or upload one now">${tb('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-9 9"/>')}<span class="tb-label">Media</span></button>
          <button type="button" class="tb-wide" id="add-python" title="Embed a single-file Python program that runs on the page">${tb('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 10 3 2.5L7 15M12.5 15H17"/>')}<span class="tb-label">Python app</span></button>
          <button type="button" class="tb-wide" id="add-youtube" title="Embed a YouTube video">${tb('<rect x="3" y="5.5" width="18" height="13" rx="3.5"/><path d="M10.5 9.5v5l4-2.5Z"/>')}<span class="tb-label">YouTube</span></button>
          <button type="button" class="tb-wide" id="add-html-block" title="Insert a custom HTML block">${tb('<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>')}<span class="tb-label">HTML block</span></button>
          <button type="button" class="tb-wide" id="add-page-break" title="Mark where a printed page ends (Print only)">${tb('<path d="M6 3v5h12V3M6 21v-5h12v5"/><path d="M3 12h2M8 12h2M14 12h2M19 12h2"/>')}<span class="tb-label">Page break</span></button>
          ${type === 'post' ? html`<button type="button" class="tb-wide" data-open-picker="featured" title="Choose the post's featured image">${tb('<path d="m12 4 2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.200 18.9l1-5.4-4-3.8 5.4-.7Z"/>')}<span class="tb-label">Featured image</span></button>` : ''}
        </div>
      </div>
      <div id="image-tools" class="image-tools" hidden role="group" aria-label="Selected image size and alignment">
        <b>Image</b>
        <span class="image-tools__set">
          <button type="button" data-img-size="25">S 25%</button>
          <button type="button" data-img-size="50">M 50%</button>
          <button type="button" data-img-size="75">L 75%</button>
          <button type="button" data-img-size="100">Full 100%</button>
        </span>
        <label>Width <input type="range" id="img-width" min="10" max="100" step="1" value="50"> <output id="img-width-out" for="img-width">50%</output></label>
        <span class="image-tools__set">
          <button type="button" data-img-align="left">Left</button>
          <button type="button" data-img-align="center" aria-pressed="true">Center</button>
          <button type="button" data-img-align="right">Right</button>
        </span>
        <span class="image-tools__set">
          <button type="button" data-img-alt title="Describe the image for screen readers">Alt</button>
          <button type="button" data-img-caption title="Add or edit the caption under the image">Caption</button>
          <button type="button" data-img-link title="Link the image to a URL">Link</button>
        </span>
        <span class="image-tools__set">
          <button type="button" data-block-move="up" title="Move above the previous block" aria-label="Move up">&uarr;</button>
          <button type="button" data-block-move="down" title="Move below the next block" aria-label="Move down">&darr;</button>
          <button type="button" data-img-remove class="image-tools__danger" title="Remove (Delete)">Remove</button>
        </span>
      </div>
      <div id="python-tools" class="image-tools" hidden role="group" aria-label="Selected Python app size and placement">
        <b>Python app</b>
        <span class="image-tools__set">
          <button type="button" data-img-size="50">50%</button>
          <button type="button" data-img-size="75">75%</button>
          <button type="button" data-img-size="100">Full</button>
        </span>
        <label>Height <input type="number" id="py-height" min="160" max="1200" step="10" value="420" inputmode="numeric"> px</label>
        <span class="image-tools__set">
          <button type="button" data-img-align="left">Left</button>
          <button type="button" data-img-align="center" aria-pressed="true">Center</button>
          <button type="button" data-img-align="right">Right</button>
        </span>
        <span class="image-tools__set">
          <button type="button" data-py-edit title="Change the code, the file or the area">Edit code</button>
          <button type="button" data-py-autorun aria-pressed="true" title="Start when a visitor scrolls to it; off shows a Run button first">Auto-start</button>
        </span>
        <span class="image-tools__set">
          <button type="button" data-block-move="up" title="Move above the previous block" aria-label="Move up">&uarr;</button>
          <button type="button" data-block-move="down" title="Move below the next block" aria-label="Move down">&darr;</button>
          <button type="button" data-img-remove class="image-tools__danger" title="Remove (Delete)">Remove</button>
        </span>
      </div>
      <p class="ams-editor-drop" id="image-drop-hint" hidden>Drop an image to upload and place it here.</p>
      <div id="img-overlay" class="img-overlay" hidden aria-hidden="true"><span data-handle="nw"></span><span data-handle="ne"></span><span data-handle="sw"></span><span data-handle="se"></span><span data-handle="w"></span><span data-handle="e"></span><span data-handle="s"></span><output id="img-overlay-size" class="img-overlay__size" hidden></output></div>
      <div id="visual-editor" class="visual-editor ams-editor-pane" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="content-label" data-placeholder="Write your content here…" hidden></div>
      <textarea id="body" name="body" class="code ams-editor-pane" spellcheck="true" aria-label="Content (HTML source)">${row?.body ?? ''}</textarea>
      <p class="ams-editor-status" id="editor-status" role="status" aria-live="polite"></p>
    </div>
    <p class="hint">Text and HTML always show the same content: switch freely, nothing is lost. Paste keeps the words and drops foreign styling. Ctrl/Cmd+S saves, Ctrl/Cmd+B/I/U format, Ctrl/Cmd+Shift+K makes a link. Click an image or a Python app to resize it by its handles; Delete removes it.</p>
    ${can(c.var.user, 'manage_settings') ? html`<p class="hint">Admin HTML is not sanitized when you save.</p>` : html`<p class="hint">Unsafe HTML is removed when you save. YouTube embeds and Python apps added with their toolbar buttons are allowed.</p>`}
  </div>
  ${postFields}
  ${pageFields}
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
    ${pageParentField}
    ${type === 'page' && await hasColumn(c.env, 'content', 'icon') ? html`<label for="page-icon">Page icon</label>
    <select id="page-icon" name="icon"><option value="">Default page icon</option>${PAGE_ICONS.map((name) => html`<option value="${name}"${row?.icon === name ? raw(' selected') : raw('')}>${name}</option>`)}</select>
    <p class="hint">Used in the Pages tree and available to themes.</p>` : ''}
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
<dialog id="link-dialog" aria-labelledby="link-dialog-title">
  <h2 id="link-dialog-title">Add link</h2>
  <p class="hint">A web address, a mailto:, a phone number, or a path on this site such as <code>/contact</code>. Anything else is refused rather than saved as a dead link.</p>
  <label for="link-url">Link address</label>
  <input type="text" id="link-url" inputmode="url" autocomplete="off" placeholder="https://example.com/page">
  <label for="link-text">Words to show <span class="muted">(leave empty to use the address)</span></label>
  <input type="text" id="link-text" maxlength="200" autocomplete="off">
  <label class="check"><input type="checkbox" id="link-newtab"> Open in a new tab</label>
  <p class="form-error" id="link-error" role="alert" hidden></p>
  <div class="row dialog-actions">
    <button type="button" class="btn ghost small" id="link-remove" hidden>Remove link</button>
    <span class="dialog-grow"></span>
    <button type="button" class="btn ghost" data-close-dialog>Cancel</button>
    <button type="button" class="btn" id="insert-link">Save link</button>
  </div>
</dialog>
<dialog id="image-block-dialog" aria-labelledby="image-block-dialog-title">
  <h2 id="image-block-dialog-title">Place this image</h2>
  <div class="image-block-form">
    <div class="image-block-form__preview" id="image-block-preview"></div>
    <div class="image-block-form__fields">
      <label for="image-block-alt">Alt text</label>
      <input type="text" id="image-block-alt" maxlength="200" placeholder="Describe the image for screen readers">
      <label for="image-block-caption">Caption <span class="muted">(optional)</span></label>
      <input type="text" id="image-block-caption" maxlength="300" placeholder="Shown under the image">
      <label for="image-block-link">Image link <span class="muted">(optional)</span></label>
      <input type="text" id="image-block-link" autocomplete="off" placeholder="https://…">
      <label for="image-block-width">Width</label>
      <p class="row image-block-form__width"><input type="range" id="image-block-width" min="10" max="100" step="5" value="50"> <output id="image-block-width-out" for="image-block-width">50%</output></p>
    </div>
  </div>
  <p class="form-error" id="image-block-error" role="alert" hidden></p>
  <div class="row dialog-actions">
    <button type="button" class="btn ghost" data-close-dialog>Cancel</button>
    <button type="button" class="btn" id="insert-image-block">Insert image</button>
  </div>
</dialog>
<dialog id="python-dialog" aria-labelledby="python-dialog-title">
  <h2 id="python-dialog-title">Add Python app</h2>
  <p class="hint">Choose a single-file <code>.py</code> program. It runs in each visitor's browser, in a sandbox that cannot touch your site, so no server is needed. Programs can use <code>print()</code> and <code>input()</code>, or <code>ams_gui()</code> for browser buttons and forms. <code>ams_pick_file()</code> / <code>ams_download()</code> move a file. Try the GUI calculator sample.</p>
  <div class="py-file">
    <button type="button" class="btn ghost" id="python-file-button">${icon('upload', { cls: 'ico--sm' })} Choose .py file</button>
    <input type="file" id="python-file" accept=".py,.pyw,text/x-python,text/plain" hidden>
    <label class="py-sample" for="python-sample"><span class="muted">or</span>
      <select id="python-sample" aria-label="Start from a sample program"></select>
    </label>
    <span class="muted" id="python-file-name">No file chosen</span>
  </div>
  <label for="python-code">Code <span class="muted">(paste or edit here)</span></label>
  <textarea id="python-code" class="code py-code" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="name = input(&quot;Your name: &quot;)&#10;print(&quot;Hello,&quot;, name)"></textarea>
  <ul class="py-warnings" id="python-warnings" hidden></ul>
  <fieldset class="py-area">
    <legend>Area on the page</legend>
    <div class="py-area__grid">
      <div class="py-area__fields">
        <label for="python-width">Width</label>
        <p class="row image-block-form__width"><input type="range" id="python-width" min="30" max="100" step="5" value="100"> <output id="python-width-out" for="python-width">100%</output></p>
        <label for="python-height">Height</label>
        <p class="row image-block-form__width"><input type="range" id="python-height" min="200" max="900" step="10" value="420"> <output id="python-height-out" for="python-height">420px</output></p>
      </div>
      <div class="py-area__page" aria-hidden="true"><span></span><span></span><i id="python-area-box"></i><span></span></div>
    </div>
    <p class="hint">After inserting, click the app in the editor and drag its handles to resize it right on the page.</p>
    <label class="check"><input type="checkbox" id="python-autorun" checked> Start automatically when a visitor scrolls to it</label>
  </fieldset>
  <p class="form-error" id="python-error" role="alert" hidden></p>
  <div class="row dialog-actions">
    <button type="button" class="btn ghost" data-close-dialog>Cancel</button>
    <button type="button" class="btn" id="insert-python">Insert app</button>
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
${raw(mediaPicker({ endpoint: `${base}/media/picker`, uploadUrl: `${base}/media/picker/upload`, csrf: c.var.csrf }))}
${row ? card({
  title: 'History',
  actions: html`<a class="btn ghost small" href="${base}/${kind}/${row.id}/revisions">All ${revisionCount} version${revisionCount === 1 ? '' : 's'}</a>`,
  body: html`<p class="hint" style="margin-top:0">A snapshot is kept every time you save, plus an autosave while you type. Restoring is reversible: the current version is saved first.</p>
  <p class="muted" style="margin:0"><span data-autosave-status role="status" aria-live="polite">Autosave is on: your work is kept every 30 seconds.</span></p>`,
}) : ''}
${row ? html`<form method="post" action="${base}/${kind}/${row.id}/delete" id="delete">${csrfField(c)}<button class="btn danger" type="submit">Delete ${type}</button></form>` : ''}
${raw(PICKER_JS)}
<script type="application/json" id="python-samples">${raw(safeJson(PYTHON_SAMPLES))}</script>
${raw(EDITOR_UTILS_JS)}
${raw(EDITOR_JS)}
${hierarchyAvailable ? raw(PAGE_PARENT_JS) : ''}`, '/' + kind);
}

/** JSON that is safe inside a <script type="application/json"> element. */
const safeJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

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
  let qePostPagesReady = kind === 'posts' && await hasTable(c.env, 'content_pages');
  const hasParentCol = qePostPagesReady && await hasColumn(c.env, 'content', 'parent_id');
  const [qeAllPages, qeMyPages] = qePostPagesReady
    ? await Promise.all([
      c.env.DB.prepare(
        `SELECT id, title, slug, ${hasParentCol ? 'parent_id' : 'NULL AS parent_id'}, status, COALESCE(menu_order,0) AS menu_order
         FROM content WHERE site_id=1 AND type='page' ORDER BY COALESCE(menu_order,0), title COLLATE NOCASE LIMIT 500`,
      ).all<PageHierarchyRow>().catch(() => ({ results: [] as PageHierarchyRow[] })),
      c.env.DB.prepare('SELECT page_id FROM content_pages WHERE content_id=?').bind(id).all<{ page_id: number }>()
        .catch(() => { qePostPagesReady = false; return { results: [] as { page_id: number }[] }; }),
    ])
    : [{ results: [] as PageHierarchyRow[] }, { results: [] as { page_id: number }[] }];
  const qeSelectedPages = new Set(qeMyPages.results.map((p) => p.page_id));
  const qePageTree = orderedPageTree(qeAllPages.results);
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
  ${qePostPagesReady && qePageTree.length ? html`<label>Show on page(s) only</label>
  <input type="hidden" name="page_ids_present" value="1">
  <div class="checks">${qePageTree.map(({ page, depth }) => html`<label class="check"><input type="checkbox" name="page_ids" value="${page.id}"${qeSelectedPages.has(page.id) ? raw(' checked') : ''}> ${'— '.repeat(depth)}${page.title}${page.status === 'draft' ? ' (draft)' : ''}</label>`)}</div>` : ''}
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
    let savePages = (f.has('page_ids_present') || f.has('page_ids')) && await hasTable(c.env, 'content_pages');
    if (savePages) {
      try {
        await c.env.DB.prepare('SELECT 1 FROM content_pages LIMIT 1').first();
      } catch {
        savePages = false;
      }
    }
    const pageIds = savePages
      ? [...new Set(f.getAll('page_ids').map((v) => Number(v)).filter((n) => Number.isSafeInteger(n) && n > 0))]
      : [];
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM content_terms WHERE content_id=? AND term_id IN (SELECT id FROM terms WHERE taxonomy='category')").bind(id),
      c.env.DB.prepare("DELETE FROM content_terms WHERE content_id=? AND term_id IN (SELECT id FROM terms WHERE taxonomy='tag')").bind(id),
      ...catIds.map((tid) => c.env.DB.prepare("INSERT OR IGNORE INTO content_terms (content_id,term_id) SELECT ?,id FROM terms WHERE id=? AND site_id=1 AND taxonomy='category'").bind(id, tid)),
      ...tagIds.map((t) => c.env.DB.prepare("INSERT OR IGNORE INTO content_terms (content_id,term_id) VALUES (?,?)").bind(id, t.id)),
      ...(savePages ? [
        c.env.DB.prepare('DELETE FROM content_pages WHERE content_id=?').bind(id),
        ...pageIds.map((pid) => c.env.DB.prepare("INSERT OR IGNORE INTO content_pages (content_id,page_id) SELECT ?,id FROM content WHERE id=? AND site_id=1 AND type='page'").bind(id, pid)),
      ] : []),
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
  if (kind === 'posts' && await hasTable(c.env, 'content_pages')) {
    await c.env.DB.prepare('INSERT OR IGNORE INTO content_pages (content_id,page_id) SELECT ?,page_id FROM content_pages WHERE content_id=?').bind(copyId, id).run();
  }
  if (kind === 'pages' && await hasColumn(c.env, 'content', 'parent_id') && row.parent_id != null) {
    await c.env.DB.prepare("UPDATE content SET parent_id=? WHERE id=? AND type='page' AND site_id=1").bind(row.parent_id, copyId).run();
  }
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
  const hierarchyAvailable = type === 'page' && await hasColumn(c.env, 'content', 'parent_id');
  let parentId: number | null = existing?.parent_id ?? null;
  if (hierarchyAvailable) {
    const rawParent = f.has('parent_id') ? str('parent_id').trim() : undefined;
    const wantedParent = rawParent === undefined
      ? existing?.parent_id ?? null
      : rawParent === '' ? null : Number(rawParent);
    if (rawParent !== undefined && rawParent !== '' && (!Number.isSafeInteger(wantedParent) || (wantedParent ?? 0) < 1)) {
      return go(c, id ? `/${kind}/${id}` : `/${kind}/new`, { err: 'Choose a valid parent page.' });
    }
    if (settings.home_page_id === String(id) && wantedParent != null) {
      return go(c, `/${kind}/${id}`, { err: 'The site home page cannot have a parent.' });
    }
    if (wantedParent != null) {
      const pageRows = (await db.prepare(
        "SELECT id, title, slug, parent_id, status, COALESCE(menu_order,0) AS menu_order FROM content WHERE site_id=1 AND type='page'",
      ).all<PageHierarchyRow>()).results;
      const pageMap = new Map(pageRows.map((page) => [page.id, page]));
      if (!pageMap.has(wantedParent)) {
        return go(c, id ? `/${kind}/${id}` : `/${kind}/new`, { err: 'That parent page no longer exists. Choose another one.' });
      }
      if (id && pageDescendants(id, pageRows).has(wantedParent)) {
        return go(c, `/${kind}/${id}`, { err: 'A page cannot be its own parent or a child of one of its descendants.' });
      }
      const newDepth = pageDepth(wantedParent, pageMap) + 1;
      const subtreeHeight = id ? pageSubtreeHeight(id, pageRows) : 0;
      if (newDepth > MAX_PAGE_DEPTH || newDepth + subtreeHeight > MAX_PAGE_DEPTH) {
        return go(c, id ? `/${kind}/${id}` : `/${kind}/new`, { err: `Page nesting is limited to ${MAX_PAGE_DEPTH + 1} levels.` });
      }
      parentId = wantedParent;
    } else {
      parentId = null;
    }
  }
  const chosen = type === 'post' && str('publish_at') ? localToUtc(str('publish_at'), settings.timezone || 'UTC') : null;
  let publishedAt = chosen ?? existing?.published_at ?? null;
  if (status === 'scheduled') {
    if (!chosen) return go(c, id ? `/${kind}/${id}` : `/${kind}/new`, { err: 'Pick a publish date to schedule this post.' });
    if (chosen <= now) status = 'published';
  } else if (status === 'published') {
    if (!publishedAt || publishedAt > now) publishedAt = now;
  }

  const featuredRaw = Number(str('featured_media_id')) || 0;
  const featured = f.has('featured_media_id') ? (featuredRaw && (await db.prepare("SELECT 1 AS x FROM media WHERE id=? AND site_id=1 AND mime LIKE 'image/%'").bind(featuredRaw).first()) ? featuredRaw : null) : (existing?.featured_media_id ?? null);
  const excerpt = f.has('excerpt') ? str('excerpt').trim().slice(0, 500) : (existing?.excerpt ?? '');
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
  const saveParent = type === 'page' && hierarchyAvailable;
  const saveIcon = type === 'page' && await hasColumn(c.env, 'content', 'icon');
  const pageIcon = f.has('icon') ? (PAGE_ICONS.includes(str('icon') as typeof PAGE_ICONS[number]) ? str('icon') : '') : (existing?.icon || '');
  if (existing) {
    const parentSet = saveParent ? ', parent_id=?' : '';
    const iconSet = saveIcon ? ', icon=?' : '';
    await db.prepare(`UPDATE content SET title=?, slug=?, body=?, excerpt=?, status=?, seo_title=?, seo_description=?, featured_media_id=?, published_at=?, template=?${parentSet}${iconSet}, updated_at=?${trackEditor ? ', updated_by=?' : ''} WHERE id=?`)
      .bind(title, slug, body, excerpt, status, seoTitle, seoDesc, featured, publishedAt, template,
        ...(saveParent ? [parentId] : []), ...(saveIcon ? [pageIcon] : []), now, ...(trackEditor ? [c.var.user.id] : []), id).run();
  } else {
    const columns = ['site_id', 'type', 'title', 'slug', 'body', 'excerpt', 'status', 'seo_title', 'seo_description',
      'featured_media_id', 'author_id', 'published_at', 'template'];
    const values: (string | number | null)[] = [type, title, slug, body, excerpt, status, seoTitle, seoDesc,
      featured, c.var.user.id, publishedAt, template];
    if (saveParent) { columns.push('parent_id'); values.push(parentId); }
    if (saveIcon) { columns.push('icon'); values.push(pageIcon); }
    columns.push('created_at', 'updated_at');
    values.push(now, now);
    if (trackEditor) { columns.push('updated_by'); values.push(c.var.user.id); }
    const placeholders = ['1', ...values.map(() => '?')].join(',');
    const res = await db.prepare(`INSERT INTO content (${columns.join(',')}) VALUES (${placeholders})`).bind(...values).run();
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
    let savePages = (f.has('page_ids_present') || f.has('page_ids')) && await hasTable(c.env, 'content_pages');
    if (savePages) {
      try {
        await db.prepare('SELECT 1 FROM content_pages LIMIT 1').first();
      } catch {
        savePages = false;
      }
    }
    const pageIds = savePages
      ? [...new Set(f.getAll('page_ids').map((v) => Number(v)).filter((n) => Number.isSafeInteger(n) && n > 0))]
      : [];
    const stmts = [
      db.prepare('DELETE FROM content_terms WHERE content_id=?').bind(savedId),
      ...wanted.map((t) => db.prepare('INSERT OR IGNORE INTO terms (site_id,taxonomy,name,slug) VALUES (1,?,?,?)').bind(t.taxonomy, t.name, t.slug)),
      ...wanted.map((t) => db.prepare('INSERT OR IGNORE INTO content_terms (content_id,term_id) SELECT ?, id FROM terms WHERE site_id=1 AND taxonomy=? AND slug=?').bind(savedId, t.taxonomy, t.slug)),
      ...catIds.map((tid) => db.prepare("INSERT OR IGNORE INTO content_terms (content_id,term_id) SELECT ?, id FROM terms WHERE id=? AND site_id=1 AND taxonomy='category'").bind(savedId, tid)),
      // drop tags nobody uses any more
      db.prepare("DELETE FROM terms WHERE taxonomy='tag' AND id NOT IN (SELECT term_id FROM content_terms)"),
      ...(savePages ? [
        db.prepare('DELETE FROM content_pages WHERE content_id=?').bind(savedId),
        ...pageIds.map((pid) => db.prepare("INSERT OR IGNORE INTO content_pages (content_id,page_id) SELECT ?, id FROM content WHERE id=? AND site_id=1 AND type='page'").bind(savedId, pid)),
      ] : []),
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
  if (kind === 'pages' && await hasColumn(c.env, 'content', 'parent_id')) {
    await c.env.DB.prepare("UPDATE content SET parent_id=NULL WHERE site_id=1 AND type='page' AND parent_id=?").bind(id).run();
  }
  const postPagesReady = await hasTable(c.env, 'content_pages');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM content_terms WHERE content_id=?').bind(id),
    ...(postPagesReady ? [
      kind === 'pages'
        ? c.env.DB.prepare('DELETE FROM content_pages WHERE page_id=?').bind(id)
        : c.env.DB.prepare('DELETE FROM content_pages WHERE content_id=?').bind(id),
    ] : []),
    c.env.DB.prepare('DELETE FROM content_lock WHERE content_id=?').bind(id),
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
