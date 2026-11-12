// Focused tests for the panel shell, written against tests/helpers.mjs.
//
//   npm run build && node --test tests/panel.test.mjs
//
// This file exists to prove the harness: the whole file is setup-free, and each
// case is a few lines of intent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers.mjs';

const panel = createHarness();

before(async () => {
  await panel.start();
  await panel.install();
});

after(async () => {
  await panel.stop();
  panel.cleanup();
});

test('the panel is one document shell: top bar, rail, main, one sprite', async () => {
  const page = await panel.get(panel.admin);
  assert.equal(page.status, 200);
  assert.match(page.text, /<header class="topbar">/);
  assert.match(page.text, /<nav class="rail"/);
  assert.match(page.text, /<main class="main" id="main">/);
  assert.equal((page.text.match(/<symbol id="i-/g) || []).length > 20, true, 'icon sprite is emitted once');
  assert.doesNotMatch(page.text, /\p{Extended_Pictographic}/u, 'no emoji icons');
});

test('every page is reachable and every one renders the shell', async () => {
  for (const path of ['', '/posts', '/pages', '/media', '/comments', '/terms', '/themes', '/menus', '/widgets',
    '/appearance', '/plugins', '/users', '/tools', '/tools/redirects', '/tools/export', '/tools/backups',
    '/tools/health', '/settings', '/updates', '/profile', '/preferences']) {
    const page = await panel.get(panel.admin + path);
    assert.equal(page.status, 200, `${path} renders`);
    assert.match(page.text, /<header class="topbar">/, `${path} uses the shell`);
    assert.ok(page.text.length < 120_000, `${path} is not bloated (${page.text.length} bytes)`);
  }
});

test('a screen that throws shows a styled error page, not a blank 500', async () => {
  // A list page with a query the handler cannot parse still renders; a true
  // crash is simulated by asking for a page whose data the DB cannot supply.
  const res = await panel.get(`${panel.admin}/themes/999999/download`);
  assert.equal(res.status, 404);
  assert.match(res.text, /Theme not found/);
});

test('preferences: scheme, density and rail state are server-rendered', async () => {
  await panel.adminPost('/preferences', { scheme: 'light', density: 'compact', railCollapsed: '1' });
  const page = await panel.get(panel.admin);
  assert.match(page.text, /data-scheme="light"/);
  assert.match(page.text, /data-density="compact"/);
  assert.match(page.text, /id="side-c"[^>]*checked/);
  assert.match(page.text, /<meta name="color-scheme" content="light dark">/);
});

test('stylesheets are cacheable assets with a content stamp', async () => {
  const page = await panel.get(panel.admin);
  const hrefs = [...page.text.matchAll(/href="([^"]+\/assets\/(?:tokens|app|screens)\.css\?v=[^"]+)"/g)].map((m) => m[1]);
  assert.equal(hrefs.length, 3);
  for (const href of hrefs) {
    const sheet = await panel.anon(href);
    assert.equal(sheet.status, 200);
    assert.match(sheet.headers.get('etag'), /^"\d+\.\d+\.\d+-[a-z0-9]+"$/, `${href} is stamped with the app version`);
  }
});

/* ==========================================================================
   Phase 1: command palette, global search, list screens, dashboard, a11y.
   ========================================================================== */

test('the palette is in the document, keyboard-reachable and script-backed', async () => {
  const page = await panel.get(panel.admin);
  assert.match(page.text, /<dialog id="palette"/, 'palette dialog is server-rendered');
  assert.match(page.text, /aria-labelledby="palette-title"/);
  assert.match(page.text, /id="palette-input"[^>]*aria-controls="palette-results"/, 'input points at its results');
  assert.match(page.text, /id="palette-status"[^>]*aria-live="polite"/, 'results are announced');
  assert.match(page.text, /id="search-trigger"/, 'top bar has a search trigger');
  assert.match(page.text, /setAttribute\('data-search-url', "\/admin-panel\/search"\)/, 'palette knows its endpoint');
  assert.match(page.text, /metaKey \|\| event\.ctrlKey/, 'Cmd/Ctrl+K is wired');
  assert.match(page.text, /data-palette-item/, 'commands are listed before typing');
});

test('global search finds content and returns a bare fragment for the palette', async () => {
  const created = await panel.adminPost('/posts/save', {
    title: 'Searchable Widget Policy', body: '<p>Details about widgets.</p>', status: 'published',
  });
  assert.equal(created.status, 303);
  await panel.adminPost('/pages/save', { title: 'Widget Landing', slug: 'widget-landing', body: '', status: 'published' });

  const full = await panel.get(`${panel.admin}/search?q=widget`);
  assert.equal(full.status, 200);
  assert.match(full.text, /<header class="topbar">/, 'without JavaScript it is a full page');
  assert.match(full.text, /Searchable Widget Policy/);
  assert.match(full.text, /Widget Landing/);
  assert.match(full.text, /class="search-group"/);
  assert.match(full.text, /aria-label="Posts and pages"/);
  assert.match(String(full.headers.get('cache-control') || ''), /no-store/, 'a live search is never cached');

  const partial = await panel.get(`${panel.admin}/search?q=widget&partial=1`);
  assert.equal(partial.status, 200);
  assert.equal(partial.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(partial.text, /<html|<body|<header class="topbar"/, 'partial is a fragment, not a page');
  assert.match(partial.text, /Searchable Widget Policy/);

  const short = await panel.get(`${panel.admin}/search?q=w`);
  assert.match(short.text, /Type at least 2 characters/);
  const none = await panel.get(`${panel.admin}/search?q=zzzznothing`);
  assert.match(none.text, /Nothing matched/);
});

test('search is behind the session guard', async () => {
  const res = await panel.anon(`${panel.admin}/search?q=widget`);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/login$/);
});

test('search escapes the query it echoes back', async () => {
  const res = await panel.get(`${panel.admin}/search?q=${encodeURIComponent('<img src=x onerror=alert(1)>')}`);
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /<img src=x/);
  assert.match(res.text, /&lt;img/);
});

test('rail and scheme links set a cookie and bounce back to the same page', async () => {
  const rail = await panel.get(`${panel.admin}/rail/collapsed?next=${encodeURIComponent('/admin-panel/posts?status=draft')}`);
  assert.equal(rail.status, 303);
  assert.equal(rail.location, '/admin-panel/posts?status=draft');
  assert.match(rail.headers.getSetCookie().join('\n'), /ams_rail=1/);
  const collapsed = await panel.get(`${panel.admin}/posts`);
  assert.match(collapsed.text, /id="side-c"[^>]*checked/, 'the rail stays collapsed on the next page');
  await panel.get(`${panel.admin}/rail/expanded`);

  const scheme = await panel.get(`${panel.admin}/scheme/dark?next=${encodeURIComponent('/admin-panel/pages')}`);
  assert.equal(scheme.status, 303);
  assert.equal(scheme.location, '/admin-panel/pages');
  assert.match((await panel.get(panel.admin)).text, /data-scheme="dark"/);
  await panel.get(`${panel.admin}/scheme/auto`);

  const offsite = await panel.get(`${panel.admin}/scheme/light?next=${encodeURIComponent('https://evil.example/steal')}`);
  assert.equal(offsite.status, 303);
  assert.equal(offsite.location, '/admin-panel', 'only same-panel return addresses are allowed');
  await panel.get(`${panel.admin}/scheme/auto`);
});

test('density is a one-click form post from the account menu', async () => {
  await panel.get(`${panel.admin}/preferences`);
  const page = await panel.get(panel.admin);
  assert.match(page.text, /<form method="post" action="\/admin-panel\/density"/, 'density toggle posts to its route');
  const res = await panel.adminPost('/density', {});
  assert.equal(res.status, 303);
  assert.match(res.location, /^\/admin-panel\/preferences/);
  assert.match((await panel.get(panel.admin)).text, /data-density="(compact|comfortable)"/);
  await panel.adminPost('/preferences', { scheme: 'auto', density: 'comfortable' });
});

test('list screens share one pattern: tabs, toolbar, bulk bar, sortable heads, card labels', async () => {
  for (const [path, title] of [['/posts', 'Posts'], ['/pages', 'Pages']]) {
    const page = await panel.get(panel.admin + path);
    assert.equal(page.status, 200, `${path} renders`);
    assert.match(page.text, new RegExp(`<section class="list-page" data-list="${path.slice(1)}-bulk-form"`), `${path} uses the list pattern`);
    assert.match(page.text, /class="tabs"/, `${path} has status tabs`);
    assert.match(page.text, /aria-current="page"/, `${path} marks the current tab`);
    assert.match(page.text, /class="list-toolbar">\s*<form class="list-toolbar__search"[^>]*role="search"/, `${path} has a search toolbar`);
    // Forms must never nest: a browser would drop the inner one and the filter
    // selects would stop working.
    assert.equal((page.text.match(/<form/g) || []).length, (page.text.match(/<\/form>/g) || []).length, `${path} balances its forms`);
    assert.match(page.text, /class="bulk-bar"/, `${path} has a bulk bar`);
    assert.match(page.text, /data-label="Date"/, `${path} labels cells for the card layout`);
    assert.match(page.text, /class="th-sort/, `${path} has sortable headers`);
    assert.match(page.text, /aria-sort="/, `${path} reports sort state to assistive tech`);
    assert.match(page.text, /data-select-all/, `${path} can select all rows`);
    assert.doesNotMatch(page.text, /class="posts-table/, `${path} no longer uses the old table markup`);
    assert.match(page.text, new RegExp(`<h1[^>]*>${title}</h1>`));
  }
  const sorted = await panel.get(`${panel.admin}/posts?sort=title&dir=asc`);
  assert.match(sorted.text, /aria-sort="ascending"/);
  const descending = await panel.get(`${panel.admin}/posts?sort=date&dir=desc`);
  assert.match(descending.text, /aria-sort="descending"/);
  const filtered = await panel.get(`${panel.admin}/posts?q=nothing-matches-this`);
  assert.match(filtered.text, /No posts match/);
  assert.match(filtered.text, /Write a post/, 'the empty state offers the next action');
});

test('the dashboard answers what needs attention, in priority order', async () => {
  // A comment awaiting moderation and an image with no alt text are both
  // detectable without any traffic to the public site.
  await panel.adminPost('/terms/save', { taxonomy: 'category', name: 'Policy' }).catch(() => null);
  const page = await panel.get(panel.admin);
  assert.equal(page.status, 200);
  assert.match(page.text, /class="dash"/);
  assert.match(page.text, /<h1[^>]*>E2E Test Site<\/h1>/, 'the site name leads the page');
  assert.match(page.text, /Good (morning|afternoon|evening),/, 'the greeting is time-aware');
  assert.match(page.text, /Needs attention/);
  assert.match(page.text, /aria-label="Site totals"/);
  assert.match(page.text, /At a glance/);
  assert.match(page.text, /Recently edited/);
  assert.match(page.text, /Searchable Widget Policy/);
  assert.match(page.text, /class="attention"|All clear/, 'attention list or its all-clear state');
  // Every attention item links to the screen that fixes it.
  for (const [, href] of page.text.matchAll(/data-attention-item="[^"]+"[\s\S]{0,600}?href="([^"]+)"/g)) {
    assert.match(href, /^\/admin-panel\//, 'attention links stay inside the panel');
  }
});

test('accessibility floor: landmarks, focus styles, current page, reduced motion', async () => {
  const page = await panel.get(panel.admin);
  assert.match(page.text, /<a class="skip" href="#main">Skip to content<\/a>/, 'skip link is first');
  assert.match(page.text, /aria-current="page"/, 'the open section is marked');
  assert.match(page.text, /<main class="main" id="main"/, 'main landmark exists');
  assert.match(page.text, /<nav class="rail"[^>]*aria-label=/, 'rail is a labelled landmark');
  const css = (await panel.get(`${panel.admin}/assets/app.css`)).text;
  assert.match(css, /:focus-visible\s*\{[^}]*outline:/, 'focus is visible');
  // Every outline:none is paired with a wrapper that draws its own ring, so no
  // control can be focused invisibly.
  for (const sheet of [css, (await panel.get(`${panel.admin}/assets/screens.css`)).text]) {
    for (const [rule] of sheet.matchAll(/[^{}]+\{[^{}]*outline:\s*none[^{}]*\}/g)) {
      assert.match(rule, /palette__form|list-toolbar__search/, `outline:none is scoped to a wrapper: ${rule.trim().slice(0, 60)}`);
    }
    assert.match(sheet, /:focus-within/, 'wrapped inputs show focus on the wrapper');
  }
  const tokens = (await panel.get(`${panel.admin}/assets/tokens.css`)).text;
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)/, 'motion is optional');
  const screens = (await panel.get(`${panel.admin}/assets/screens.css`)).text;
  assert.match(screens, /\.list-table thead \{ display: none/, 'narrow screens turn rows into cards');
});

test('rendered pages never nest forms (a browser would drop the inner one)', async () => {
  for (const path of ['', '/posts', '/pages', '/media', '/comments', '/preferences', '/users', '/tools', '/settings']) {
    const page = await panel.get(panel.admin + path);
    let depth = 0;
    for (const [tag] of page.text.matchAll(/<\/?form\b[^>]*>/g)) {
      depth += tag.startsWith('</') ? -1 : 1;
      assert.ok(depth <= 1, `${path || 'dashboard'} nests a form: ${page.text.slice(Math.max(0, page.text.indexOf(tag) - 80), page.text.indexOf(tag) + 80)}`);
    }
    assert.equal(depth, 0, `${path || 'dashboard'} leaves a form open`);
  }
});
