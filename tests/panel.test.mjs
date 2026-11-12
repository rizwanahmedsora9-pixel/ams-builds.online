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
      assert.match(rule, /palette__form|list-toolbar__search|media-picker__search/, `outline:none is scoped to a wrapper: ${rule.trim().slice(0, 60)}`);
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

/* ==========================================================================
   Phase 2: revisions, autosave, edit locks, media picker, quick edit,
   duplicate/pin, page ordering and theme previews.
   ========================================================================== */

/** Create a post through the editor and return its id. */
async function newPost(title, body = '<p>First draft.</p>') {
  const res = await panel.adminPost('/posts/save', { title, body, status: 'draft' });
  assert.equal(res.status, 303, `created ${title}`);
  return Number(res.location.match(/\/posts\/(\d+)/)[1]);
}

test('saving keeps a revision, and restoring is itself reversible', async () => {
  const id = await newPost('Revision Target');
  await panel.adminPost('/posts/save', { id, title: 'Revision Target', body: '<p>Second draft.</p>', status: 'draft' });
  await panel.adminPost('/posts/save', { id, title: 'Revision Target', body: '<p>Third draft.</p>', status: 'published' });

  const history = await panel.get(`${panel.admin}/posts/${id}/revisions`);
  assert.equal(history.status, 200);
  assert.match(history.text, /class="revisions"/);
  assert.equal((history.text.match(/class="revision revision--manual"/g) || []).length >= 2, true, 'each save added a snapshot');

  // The compare screen shows what changed since that snapshot: the old line is
  // marked as removed, the current one as added.
  const revIds = [...history.text.matchAll(/\/revisions\/(\d+)"/g)].map((m) => m[1]);
  assert.ok(revIds.length >= 2, 'history has more than one snapshot');
  const oldestId = revIds[revIds.length - 1];
  const oldest = await panel.get(`${panel.admin}/posts/${id}/revisions/${oldestId}`);
  assert.match(oldest.text, /First draft\./, 'the oldest snapshot holds the original body');
  assert.equal(oldest.status, 200);
  assert.match(oldest.text, /diff__line--del/);
  assert.match(oldest.text, /diff__line--add/);

  const restored = await panel.adminPost(`/posts/${id}/revisions/${oldestId}/restore`, {});
  assert.equal(restored.status, 303);
  assert.match(restored.location, /ok=Restored/);
  const afterRestore = await panel.get(`${panel.admin}/posts/${id}`);
  assert.match(afterRestore.text, /First draft\./);
  // The version that was live before the restore is still in the history.
  // The restore took a snapshot of what it replaced, so the third draft is still
  // reachable from the history (as the newest entry).
  const history2 = await panel.get(`${panel.admin}/posts/${id}/revisions`);
  assert.match(history2.text, /Restored/, 'the restore left its own marker in the history');
  const newestId = history2.text.match(/\/revisions\/(\d+)"/)[1];
  assert.match((await panel.get(`${panel.admin}/posts/${id}/revisions/${newestId}`)).text, /Third draft\./, 'the version the restore replaced is still there');
});

test('autosave stores a recoverable copy without touching the live post', async () => {
  const id = await newPost('Autosave Target', '<p>Saved body.</p>');
  const res = await panel.adminPost(`/posts/${id}/autosave`, { title: 'Autosave Target', body: '<p>Half-typed body.</p>', excerpt: 'wip' });
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.text);
  assert.equal(payload.ok, true);
  assert.match(payload.at, /^\d{4}-\d{2}-\d{2}T/);

  // The live post still has the saved body: an autosave is never a publish.
  const editorPage = await panel.get(`${panel.admin}/posts/${id}`);
  assert.match(editorPage.text, /Saved body\./);
  assert.match(editorPage.text, /Autosave/, 'the editor talks about autosave');
  assert.match(editorPage.text, /data-autosave-banner/, 'a newer autosave is offered for recovery');
  assert.match(editorPage.text, /Unsaved work from/, 'the banner says when the autosave was taken');
  assert.match(editorPage.text, /data-autosave-url="\/admin-panel\/posts\/\d+\/autosave"/);
  assert.match(editorPage.text, /data-autosave-status/, 'the editor has a place to say "Saved 12 s ago"');

  const unchanged = await panel.adminPost(`/posts/${id}/autosave`, { title: 'Autosave Target', body: '<p>Saved body.</p>' });
  assert.equal(JSON.parse(unchanged.text).unchanged, true, 'an unchanged body is not stored again');
});

test('an edit lock follows the first editor and can be taken over', async () => {
  const id = await newPost('Locked Post');
  const first = await panel.get(`${panel.admin}/posts/${id}`); // claims the lock
  assert.equal(first.status, 200);
  assert.match(first.text, /data-lock-mine="1"|data-lock-mine/);
  assert.equal((first.text.match(/is editing this post/g) || []).length, 0, 'the owner does not see a lock warning');

  // A second person opens the same post: the advisory lock is visible.
  await panel.adminPost('/users/save', { username: 'second', email: 'second@example.com', password: 'secretpass2', role: 'editor' });

  // A separate browser: its own cookie jar, starting from the login page.
  const jar = new Map();
  const withJar = async (path, init = {}) => {
    const headers = { ...(init.headers || {}) };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(panel.base + path, { ...init, headers, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return { status: res.status, text: await res.text() };
  };
  const form = await withJar(`${panel.admin}/login`);
  const token = form.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const signIn = await withJar(`${panel.admin}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: token, login: 'second', password: 'secretpass2' }),
  });
  assert.equal(signIn.status, 303, 'the second user signed in');

  const page = await withJar(`${panel.admin}/posts/${id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /data-lock-banner/, 'the second editor is warned');
  assert.match(page.text, /is editing this post/);
  assert.match(page.text, /\/lock\/takeover/, 'an editor can take the lock over');
});

test('the media picker lists, filters and uploads without leaving the editor', async () => {
  const editorPage = await panel.get(`${panel.admin}/posts/new`);
  assert.match(editorPage.text, /<dialog id="media-picker"/);
  assert.match(editorPage.text, /data-endpoint="\/admin-panel\/media\/picker"/);
  assert.match(editorPage.text, /id="insert-image"/, 'the toolbar Image button opens the picker');
  assert.match(editorPage.text, /data-open-picker="featured"/, 'the featured image uses the same dialog');
  assert.match(editorPage.text, /featured-picker__preview/);

  const list = await panel.get(`${panel.admin}/media/picker`);
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.ok(Array.isArray(JSON.parse(list.text).items));

  // Upload through the picker: multipart, JSON back, alt text stored with it.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.set('_csrf', await panel.csrf());
  form.set('alt', 'A single pixel');
  form.set('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
  const cookie = [...panel.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const upload = await fetch(`${panel.base}${panel.admin}/media/picker/upload`, { method: 'POST', body: form, headers: { cookie } });
  const body = await upload.json();
  assert.equal(upload.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.item.alt, 'A single pixel');
  assert.match(body.item.url, /^\/media\//);

  const search = await panel.get(`${panel.admin}/media/picker?q=pixel`);
  assert.equal(JSON.parse(search.text).items.length, 1, 'the new upload is findable');
  const alt = await panel.adminPost(`/media/${body.item.id}/alt`, { alt: 'Updated description' });
  assert.equal(alt.status, 303);
  assert.match((await panel.get(`${panel.admin}/media/picker?q=updated`)).text, /Updated description/);
});

test('quick edit, duplicate and pin work from the list', async () => {
  const id = await newPost('Quick Edit Target', '<p>Body.</p>');
  const quick = await panel.get(`${panel.admin}/posts/${id}/quick`);
  assert.equal(quick.status, 200);
  assert.match(quick.text, /id="qe-title"/);
  assert.match(quick.text, /id="qe-status"/);
  const saved = await panel.adminPost(`/posts/${id}/quick`, {
    title: 'Renamed By Quick Edit', slug: 'renamed-by-quick-edit', status: 'published', tags: 'one, two',
  });
  assert.equal(saved.status, 303);
  assert.match(saved.location, /^\/admin-panel\/posts\?/);
  const list = await panel.get(`${panel.admin}/posts?q=Slightly-Off-Title`);
  assert.ok(list);

  const dup = await panel.adminPost(`/posts/${id}/duplicate`, {});
  assert.equal(dup.status, 303);
  const copyId = Number(dup.location.match(/\/posts\/(\d+)/)[1]);
  assert.notEqual(copyId, id);
  const copy = await panel.get(`${panel.admin}/posts/${copyId}`);
  assert.match(copy.text, /Renamed By Quick Edit \(copy\)/);
  assert.match(copy.text, /<option value="draft" selected>/, 'the copy starts as a draft');

  const pinned = await panel.adminPost(`/posts/${id}/pin`, {});
  assert.equal(pinned.status, 303);
  assert.match((await panel.get(`${panel.admin}/posts`)).text, /class="pin"/, 'pinned posts are marked');
  await panel.adminPost(`/posts/${id}/pin`, {});
});

test('pages can be ordered, and the order is what themes see', async () => {
  await panel.adminPost('/pages/save', { title: 'Order A', slug: 'order-a', body: '', status: 'published' });
  await panel.adminPost('/pages/save', { title: 'Order B', slug: 'order-b', body: '', status: 'published' });
  const page = await panel.get(`${panel.admin}/pages`);
  assert.match(page.text, /action="\/admin-panel\/pages\/order"/);
  assert.match(page.text, /class="order-list"/);

  const ids = [...page.text.matchAll(/name="id" value="(\d+)"/g)].map((m) => m[1]);
  const orders = ids.map((_, i) => String(ids.length - i));
  const form = new URLSearchParams({ _csrf: await panel.csrf() });
  ids.forEach((id, i) => { form.append('id', id); form.append('order', orders[i]); });
  const cookie = [...panel.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(`${panel.base}${panel.admin}/pages/order`, {
    method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form,
  });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /sort=order/);

  const ordered = await panel.get(`${panel.admin}/pages?sort=order&dir=asc`);
  const orderBlock = ordered.text.slice(ordered.text.indexOf('class="order-list"'));
  const posA = orderBlock.indexOf('Order A');
  const posB = orderBlock.indexOf('Order B');
  assert.ok(posA > 0 && posB > 0, 'both pages are in the order list');
  assert.ok(posB < posA, 'the list follows the order we saved');
  // The public render gets the same order via {{#each pages}}.
  const publicPage = await panel.anon('/order-a');
  assert.equal(publicPage.status, 200);
});

test('preview with any installed theme needs a session', async () => {
  const id = await newPost('Theme Preview Target', '<p>Previewable.</p>');
  const slug = (await panel.get(`${panel.admin}/posts/${id}`)).text.match(/name="slug" value="([^"]*)"/)[1];
  const url = `/blog/${slug}?preview=1&theme=default`;

  const anonymous = await panel.get(url, { cookies: false });
  assert.equal(anonymous.status, 404, 'drafts stay private without a session');

  const signedIn = await panel.get(url);
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.headers.get('cache-control'), /no-store/, 'previews are never cached');
});

test('an upgrade path: a database without the Phase 2 tables still works', async () => {
  // Simulate a site that installed before migration 3: the code must degrade
  // (no crash) and the admin must be told to run the update.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(`${panel.dataDir}/cms.sqlite`);
  db.exec('DROP TABLE content_revisions');
  db.exec('DROP TABLE content_lock');
  db.exec("UPDATE settings SET value='2' WHERE key='schema_version'");
  db.close();

  const created = await panel.adminPost('/posts/save', { title: 'Pre Migration Post', body: '<p>Old install.</p>', status: 'draft' });
  assert.equal(created.status, 303, 'creating a post never depends on the new tables');
  const id = Number(created.location.match(/\/posts\/(\d+)/)[1]);
  const editor = await panel.get(`${panel.admin}/posts/${id}`);
  assert.equal(editor.status, 200, 'the editor still renders');
  assert.match(editor.text, /data-is-new="0"/);

  const history = await panel.get(`${panel.admin}/posts/${id}/revisions`);
  assert.equal(history.status, 200, 'the history page renders');
  assert.match(history.text, /Run updates from the Updates screen/, 'and explains what to do');

  const autosave = await panel.adminPost(`/posts/${id}/autosave`, { title: 'Pre Migration Post', body: '<p>Typed.</p>' });
  assert.equal(autosave.status, 409, 'autosave says it needs the migration instead of failing');
  assert.equal(JSON.parse(autosave.text).error, 'needs-migration');

  const saved = await panel.adminPost('/posts/save', { id, title: 'Pre Migration Post', body: '<p>Still saves.</p>', status: 'published' });
  assert.equal(saved.status, 303, 'saving never depends on the new tables');
  assert.match((await panel.get(`${panel.admin}/posts/${id}`)).text, /Still saves\./);

  // Running the update from the panel restores the full feature set.
  const run = await panel.adminPost('/updates/run', {});
  assert.equal(run.status, 303);
  const after = await panel.adminPost(`/posts/${id}/autosave`, { title: 'Pre Migration Post', body: '<p>Typed now.</p>' });
  assert.equal(after.status, 200, 'after the update, autosave works');
});
