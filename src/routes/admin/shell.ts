import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { card, emptyState, pageHead, table } from '../../admin/components';
import { icon } from '../../admin/icons';
import { SEARCH_MIN, searchSite } from '../../admin/search';
import { go, html, layout } from '../../lib/ui';

/**
 * Panel layout and preferences, plus global search.
 *
 * The palette (⌘K) asks for `?q=…&partial=1` and receives just the result list;
 * without JavaScript the same data renders as a full /search page.
 */
const shell = new Hono<AppEnv>();

/**
 * Bounce the browser back inside the panel after a one-click state change
 * (rail collapse, colour scheme). `next` may arrive bare (`/posts`) or already
 * prefixed with the admin slug (`/admin-panel/posts`); anything else falls
 * back to the dashboard, so an off-site URL can never be used as an open
 * redirect.
 */
const redirectBack = (c: Ctx, next: string): string => {
  const clean = next.startsWith(c.var.base) ? next.slice(c.var.base.length) : next;
  return clean.startsWith('/') && !clean.startsWith('//') ? c.var.base + clean : c.var.base;
};

/** Rail state is a cookie, so the server renders the right width on the first byte. */
shell.get('/rail/:state', (c) => {
  const collapsed = c.req.param('state') === 'collapsed';
  const next = c.req.query('next') || '';
  c.header('Set-Cookie', `ams_rail=${collapsed ? '1' : '0'}; Path=/; Max-Age=31536000; SameSite=Lax`);
  // Only same-panel paths are accepted as a return address. `next` may arrive
  // bare (/posts) or already prefixed (/admin-panel/posts); normalise it so
  // the bounce-back stays inside the admin prefix either way.
  return c.redirect(redirectBack(c, next), 303);
});

/** Colour scheme from the account menu: one click, works without JavaScript. */
shell.get('/scheme/:scheme', (c) => {
  const scheme = ['auto', 'light', 'dark'].includes(c.req.param('scheme')) ? c.req.param('scheme') : 'auto';
  const next = c.req.query('next') || '';
  c.header('Set-Cookie', `ams_scheme=${scheme}; Path=/; Max-Age=31536000; SameSite=Lax`);
  return c.redirect(redirectBack(c, next), 303);
});

/** One-click density toggle from the account menu. */
shell.post('/density', (c) => {
  const current = /ams_density=compact/.test(c.req.header('cookie') || '') ? 'compact' : 'comfortable';
  const next = current === 'compact' ? 'comfortable' : 'compact';
  c.header('Set-Cookie', `ams_density=${next}; Path=/; Max-Age=31536000; SameSite=Lax`);
  return go(c, '/preferences', { ok: `Density set to ${next}.` });
});

shell.get('/search', async (c) => {
  const base = c.var.base;
  const q = (c.req.query('q') || '').slice(0, 80);
  const partial = c.req.query('partial') === '1';
  const groups = await searchSite(c.env, c.var.user, q);
  const total = groups.reduce((n, g) => n + g.hits.length, 0);

  const results = html`${groups.length
    ? groups.map((group) => html`<section class="search-group" aria-label="${group.title}">
      <h2 class="search-group__title">${group.title}</h2>
      <ul class="search-hits" role="list">
        ${group.hits.map((hit) => html`<li>
          <a class="search-hit" href="${base}/${hit.href}" data-palette-item>
            <span class="search-hit__ico">${icon(hit.icon, { cls: 'ico--sm' })}</span>
            <span class="search-hit__body">
              <b>${hit.label}</b>
              ${hit.sub ? html`<span>${hit.sub}</span>` : ''}
            </span>
            ${hit.badge ? html`<span class="badge ${hit.badge}"><span class="sr-only">status: </span>${hit.badge}</span>` : ''}
          </a>
        </li>`)}
      </ul>
    </section>`)
    : html`<p class="search-empty" role="status">${q.length < SEARCH_MIN
      ? `Type at least ${SEARCH_MIN} characters to search.`
      : `Nothing matched “${q}”.`}</p>`}`;

  if (partial) {
    return c.html(results.s, 200, { 'Cache-Control': 'no-store' });
  }

  return layout(c, q ? `Search: ${q}` : 'Search', html`
${pageHead({ title: 'Search', sub: total ? `${total} result${total === 1 ? '' : 's'} for “${q}”` : 'Search posts, pages, media, comments, categories, tags and people.' })}
<form method="get" action="${base}/search" class="card" role="search">
  <label for="q" style="margin-top:0">Search the whole site</label>
  <div class="row">
    <input type="search" id="q" name="q" value="${q}" class="grow" autofocus maxlength="80" placeholder="Title, body, filename, comment, username…">
    <button class="btn" type="submit">${icon('search', { cls: 'ico--sm' })}Search</button>
  </div>
  <p class="hint">Tip: press <kbd>Ctrl</kbd>+<kbd>K</kbd> (or <kbd>⌘</kbd>+<kbd>K</kbd>) anywhere in the panel to search without leaving the page.</p>
</form>
<div class="search-results">
  <h2 class="sr-only" id="results-title">Results</h2>
  <div aria-labelledby="results-title">${results}</div>
</div>`, '/search');
});

export default shell;
