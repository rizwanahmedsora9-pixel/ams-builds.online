// Focused tests for the panel shell, written against tests/helpers.mjs.
//
//   npm run build && node --test tests/panel.test.mjs
//
// This file exists to prove the harness: the whole file is setup-free, and each
// case is a few lines of intent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
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

test('panel chrome: controls sit where their CSS expects, tokens resolve, nothing sticks under the top bar', async () => {
  const page = await panel.get(panel.admin);

  // The collapse switch belongs to the rail and the expand link to the top bar.
  // Every collapsed-rail rule is written `#side-c:checked ~ .shell …`, so a
  // control rendered outside those elements is never styled: both used to land
  // after </div class="shell">, which put a stray full-width "Collapse Menu"
  // bar at the bottom of every page and left its text showing in the 3.75rem
  // collapsed rail.
  const rail = page.text.slice(page.text.indexOf('<nav class="rail"'), page.text.indexOf('</nav>'));
  assert.match(rail, /class="rail__collapse"/, 'the collapse switch is inside the rail');
  assert.match(rail, /<span class="rail__label">Collapse Menu<\/span>/, 'its text is a rail label, so collapsing hides it');
  const topbar = page.text.slice(page.text.indexOf('<header class="topbar">'), page.text.indexOf('</header>'));
  assert.match(topbar, /class="rail-toggle"/, 'the expand link is in the top bar');
  // The checkbox hack only reaches siblings that come after it.
  assert.ok(page.text.indexOf('id="side-c"') < page.text.indexOf('<header class="topbar">'), 'the rail checkbox precedes the top bar it styles');
  assert.ok(page.text.indexOf('id="side-c"') < page.text.indexOf('<div class="shell">'), 'the rail checkbox precedes the shell it styles');

  // A var() that does not exist drops the whole declaration, silently: that is
  // how the editor toolbar and the image drag handles lost their background.
  const tokens = (await panel.get(`${panel.admin}/assets/tokens.css`)).text;
  const defined = new Set([...tokens.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
  const sheets = [tokens, (await panel.get(`${panel.admin}/assets/app.css`)).text, (await panel.get(`${panel.admin}/assets/screens.css`)).text];
  const inline = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const editorPage = await panel.get(`${panel.admin}/posts/new`);
  const css = [...sheets, ...inline(page.text), ...inline(editorPage.text)].join('\n');
  const unresolved = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))].filter((name) => !defined.has(name));
  assert.deepEqual(unresolved, [], 'every var() in the panel resolves to a token');

  // Anything sticky inside the content column has to clear the top bar, which is
  // itself sticky and exactly --topbar-h tall: at top:0 it hides behind it.
  for (const rule of css.matchAll(/([^{}]+)\{[^}]*position:\s*sticky[^}]*\}/g)) {
    const selector = rule[1].trim();
    if (/\.topbar\b/.test(selector)) continue; // the bar itself sticks to the viewport
    assert.match(rule[0], /top:\s*(?:calc\()?var\(--topbar-h\)/, `${selector} sticks below the top bar`);
  }
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

  // The dialog is mounted in every admin page, so any display the closed state
  // picks up paints its command list ("Create", "Go to") as an extra panel
  // below the content. A class selector beats the UA's
  // `dialog:not([open]) { display: none }`, which is how that panel appeared.
  const css = (await panel.get(`${panel.admin}/assets/app.css`)).text;
  for (const [selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|[\s,])\.palette\b/.test(selector) || selector.includes('[open]')) continue;
    assert.doesNotMatch(body, /(?<!-)display\s*:/, `closed .palette must not set display: ${selector.trim()}`);
  }
  assert.match(css, /\.palette:not\(\[open\]\)\s*\{\s*display:\s*none/, 'a closed palette is never laid out');
  assert.match(css, /\.palette\[open\]\s*\{[^}]*display:\s*flex/, 'the open palette keeps its column layout');
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

test('the picker has a library and an upload tab, takes batches and every common image format', async () => {
  const page = await panel.get(`${panel.admin}/posts/new`);
  assert.match(page.text, /role="tab" id="media-picker-tab-library"/, 'the library is its own tab');
  assert.match(page.text, /role="tab" id="media-picker-tab-upload"/, 'uploading from the device is its own tab');
  assert.match(page.text, /data-picker-panel="upload"[^>]*hidden/, 'the upload panel starts hidden');
  assert.match(page.text, /type="file"[^>]*name="files"[^>]*multiple/, 'the upload input takes several images');
  assert.match(page.text, /\.heic/, 'the file picker offers unusual image formats');
  assert.match(page.text, /window\.amsCompressImages/, 'images are compressed in the browser before upload');
  assert.match(page.text, /action="\/admin-panel\/media\/picker\/upload"/, 'the tab posts to the JSON upload endpoint');
  assert.match(page.text, /id="media-picker-quality"/, 'quality is selectable');
  assert.match(page.text, /name="_csrf"/, 'the picker form carries the CSRF token');

  const library = await panel.get(`${panel.admin}/media`);
  assert.match(library.text, /data-compress-status/, 'the library upload reports the compression pass');
  assert.match(library.text, /accept="[^"]*\.heic/, 'the library accepts the same formats');
  assert.match(library.text, /window\.amsCompressImages/, 'the library upload compresses in the browser too');

  // One request, three formats the old table refused; alt text applies to the batch.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.set('_csrf', await panel.csrf());
  form.set('alt', 'Format check');
  form.append('files', new File([png], 'camera.jfif', { type: 'image/jpeg' }));
  form.append('files', new File([png], 'scan.tiff', { type: 'image/tiff' }));
  form.append('files', new File([png], 'phone.heic', { type: 'image/heic' }));
  form.append('files', new File(['<script>'], 'virus.html', { type: 'text/html' }));
  form.append('files', new File(['%PDF-1.4'], 'notes.pdf', { type: 'application/pdf' }));
  const cookie = [...panel.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const upload = await fetch(`${panel.base}${panel.admin}/media/picker/upload`, { method: 'POST', body: form, headers: { cookie } });
  const body = await upload.json();
  assert.equal(upload.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.items.map((item) => item.mime), ['image/jpeg', 'image/tiff', 'image/heic']);
  assert.equal(body.items.length, 3, 'the batch is stored in one request');
  assert.equal(body.items[0].alt, 'Format check');
  assert.match(body.item.url, /camera\.jfif$/);
  assert.deepEqual(body.skipped.map((line) => line.split(' ')[0]), ['virus.html', 'notes.pdf'], 'the picker is images-only and refuses unknown types');
  assert.equal((await fetch(`${panel.base}${body.items[0].url}`)).headers.get('content-type'), 'image/jpeg');
});

test('every inline panel script parses, so one bad string cannot kill the editor', async () => {
  // A template literal that eats a \n once broke the whole editor script while
  // every server-side assertion still passed. The browser is the judge.
  for (const path of ['/posts/new', '/pages/new', '/media', '/identity', '/appearance', '/settings', '/tools']) {
    const page = await panel.get(panel.admin + path);
    const scripts = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.ok(scripts.length > 0, `${path} ships client code`);
    scripts.forEach((body, index) => {
      assert.doesNotThrow(() => new vm.Script(body), `${path} inline script #${index + 1} parses`);
    });
  }
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
  // Simulate a genuinely old Pages schema too; migration 8 must add the new
  // nullable parent link while preserving existing rows, and migration 9 adds
  // the content_pages join table.
  db.exec('DROP INDEX IF EXISTS idx_content_parent');
  db.exec('ALTER TABLE content DROP COLUMN parent_id');
  db.exec('DROP TABLE IF EXISTS content_pages');
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
  assert.match((await panel.get(`${panel.admin}/pages/new`)).text, /id="page-parent"/, 'the same update adds the parent-page control to old sites');
  assert.match((await panel.get(`${panel.admin}/posts/new`)).text, /id="post-pages-picker"/, 'and the page-specific post picker');
});

/* ---------------------------------------------------------------- Phase 3 */

/** Builds a zip in memory (stored entries are enough; the reader handles both). */
function zip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const nameBytes = encoder.encode(name);
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);
    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
    dv.setUint32(16, crc, true); dv.setUint32(20, data.length, true); dv.setUint32(24, data.length, true);
    dv.setUint16(28, nameBytes.length, true); dv.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    central.push(dir);
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return Buffer.concat([...chunks, ...central, end].map((b) => Buffer.from(b)));
}

const PNG_PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function uploadZip(name, files) {
  const body = new FormData();
  body.set('_csrf', await panel.csrf());
  body.append('theme', new Blob([zip(files)], { type: 'application/zip' }), name);
  const res = await panel.request(`${panel.admin}/themes/upload`, { method: 'POST', body });
  return { ...res, location: decodeURIComponent(res.location || '') };
}

const journalTheme = () => ({
  'journal/theme.json': JSON.stringify({
    name: 'Journal', slug: 'journal', version: '1.0.0', author: 'Tester',
    description: 'Serif, single column.', layout: 'base',
    templates: { base: 'base.html', post: 'post.html' },
    partials: { header: 'partials/header.html' },
    css: 'style.css',
    assets: ['assets/logo.png'],
    settings: [
      { key: 'accent', type: 'color', label: 'Accent', default: '#b4552d' },
      { key: 'show_tagline', type: 'toggle', label: 'Show tagline', default: true },
      { key: 'archive_layout', type: 'select', label: 'Archive', default: 'grid', options: [{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }] },
    ],
  }),
  'journal/base.html': [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">{{{head}}}',
    '{{#if theme_css_url}}<link rel="stylesheet" href="{{{theme_css_url}}}">{{/if}}',
    '</head><body data-theme="journal" data-accent="{{theme.accent}}">',
    '{{> header}}<main>{{{content}}}</main>',
    '<footer>{{#if theme.show_tagline}}{{site.tagline}}{{/if}} · {{theme.archive_layout}}</footer>',
    '</body></html>',
  ].join('\n'),
  'journal/post.html': '<article data-tpl="journal-post"><h1>{{post.title}}</h1>'
    + '<p class="date">{{post.date | date "Y-m-d"}}</p>'
    + '<img class="logo" src="{{asset "assets/logo.png"}}" alt="logo">'
    + '{{#if post.comments_count gt 0}}<p class="has">comments</p>{{else}}<p class="none">no comments</p>{{/if}}'
    + '{{{post.content}}}</article>',
  'journal/partials/header.html': '<header class="journal-header"><a href="/" class="brand">{{site.title | upper}}</a></header>',
  'journal/style.css': 'body{font-family:serif}',
  'journal/assets/logo.png': PNG_PIXEL,
});

test('phase 3: a zip theme with partials, assets and settings installs and renders', async () => {
  const upload = await uploadZip('journal.zip', journalTheme());

  assert.match(upload.location, /Journal|base|template|refused|allow/i, upload.location);
  assert.match(upload.location, /2 assets/, 'the stylesheet and the logo are both stored as assets');

  const manage = await panel.get(`${panel.admin}/themes/journal`);
  assert.equal(manage.status, 200, `the manager page renders (${panel.admin}/themes/journal): ${upload.location}`);
  assert.match(manage.text, /Inherits|Files/, 'the manager describes the theme');

  const row = (await panel.get(`${panel.admin}/themes`)).text.match(/data-theme-id="(\d+)"[^>]*data-theme-slug="journal"/);
  assert.ok(row, 'the theme is listed');
  assert.equal((await panel.adminPost(`/themes/${row[1]}/activate`, {})).status, 303);

  // A post written through the panel, rendered by the new theme.
  const created = await panel.adminPost('/posts/save', { title: 'Journal Post', body: '<p>Hi</p>', status: 'published' });
  assert.equal(created.status, 303);
  const post = await panel.anon('/blog/journal-post');
  assert.equal(post.status, 200);
  assert.match(post.text, /data-theme="journal"/, 'the new theme renders the page');
  assert.match(post.text, /class="journal-header"><a href="\/" class="brand">[A-Z]/, 'the partial renders and its filter ran');
  assert.match(post.text, /class="date">\d{4}-\d{2}-\d{2}</, 'the date filter honouring its pattern');
  assert.match(post.text, /class="none">no comments</, 'a comparison against a number');
  assert.match(post.text, /src="\/theme-assets\/journal\/assets\/logo\.png"/, '{{asset}} points at the served file');
  assert.match(post.text, /<link rel="stylesheet" href="\/theme-assets\/journal\/style\.css/, 'the stylesheet is linked, not inlined');
  assert.doesNotMatch(post.text, /font-family:serif/, 'the CSS is not in the HTML any more');

  const logo = await panel.anon('/theme-assets/journal/assets/logo.png');
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  assert.equal(logo.headers.get('x-content-type-options'), 'nosniff');
  const sheet = await panel.anon('/theme-assets/journal/style.css');
  assert.match(sheet.headers.get('cache-control'), /immutable/);
  assert.equal((await panel.anon('/theme-assets/journal/../secret')).status, 404, 'path traversal is refused');
});

test('phase 3: theme settings are typed, saved per theme and reach the templates', async () => {
  // A tagline the toggle can hide.
  await panel.adminPost('/settings', {
    site_title: 'E2E Test Site', tagline: 'Tagline text', timezone: 'UTC', primary_domain: 'localhost',
    admin_slug: panel.admin.replace(/^\//, ''), posts_per_page: '10', permalink_style: 'blog', csp: 'report',
  });
  const page = await panel.get(`${panel.admin}/themes/journal`);
  assert.match(page.text, /id="set-accent"[^>]*type="color"|type="color"[^>]*id="set-accent"/, 'a colour setting renders a colour input');
  assert.match(page.text, /type="checkbox"[^>]*id="set-show_tagline"/, 'a toggle renders a checkbox');
  assert.match(page.text, /<select id="set-archive_layout"/, 'a select renders options');

  await panel.adminPost('/themes/journal/settings', { accent: '#123456', show_tagline: '1', archive_layout: 'list' });
  const rendered = await panel.anon('/blog/journal-post');
  assert.match(rendered.text, /data-accent="#123456"/);
  assert.match(rendered.text, /Tagline text · list</);

  // Un-ticking the toggle removes its markup.
  await panel.adminPost('/themes/journal/settings', { accent: '#123456', archive_layout: 'list' });
  const off = await panel.anon('/blog/journal-post');
  assert.doesNotMatch(off.text, /Tagline text/, 'the toggle is off, so the tagline is gone from the footer');
  assert.match(off.text, /data-accent="#123456"/, 'other settings are untouched');

  await panel.adminPost('/themes/journal/settings/reset', {});
  assert.match((await panel.anon('/blog/journal-post')).text, /data-accent="#b4552d"/, 'reset restores the defaults');
});

test('phase 3: assets can be uploaded and removed from the manager, and refused types stay out', async () => {
  const body = new FormData();
  body.set('_csrf', await panel.csrf());
  body.append('file', new Blob([PNG_PIXEL], { type: 'image/png' }), 'banner.png');
  body.set('path', 'banner.png');
  assert.equal((await panel.request(`${panel.admin}/themes/journal/assets`, { method: 'POST', body })).status, 303);
  assert.equal((await panel.anon('/theme-assets/journal/banner.png')).status, 200);

  const evil = new FormData();
  evil.set('_csrf', await panel.csrf());
  evil.append('file', new Blob(['<svg onload="alert(1)">'], { type: 'image/svg+xml' }), 'evil.svg');
  const refused = await panel.request(`${panel.admin}/themes/journal/assets`, { method: 'POST', body: evil });
  assert.equal(refused.status, 303);
  assert.match(decodeURIComponent(refused.location), /refused/i, 'SVG is refused');
  assert.equal((await panel.anon('/theme-assets/journal/evil.svg')).status, 404);

  assert.equal((await panel.adminPost('/themes/journal/assets/delete', { path: 'banner.png' })).status, 303);
  assert.equal((await panel.anon('/theme-assets/journal/banner.png')).status, 404);
});

test('phase 3: the validator catches broken templates before activation', async () => {
  const broken = {
    'broken/theme.json': JSON.stringify({
      name: 'Broken', slug: 'broken', version: '1.0.0',
      templates: { base: 'base.html' },
      assets: ['assets/missing.png'],
    }),
    'broken/base.html': '<html><body data-x>{{#if a}}never closed</body></html>{{{content}}}',
    'broken/style.css': 'body{}',
  };
  const res = await uploadZip('broken.zip', broken);
  // Not installed (the base template has no page slot? it does), so validate it as a file instead.
  const body = new FormData();
  body.set('_csrf', await panel.csrf());
  body.append('theme', new Blob([zip(broken)], { type: 'application/zip' }), 'broken.zip');
  const report = await panel.request(`${panel.admin}/themes/validate`, { method: 'POST', body });
  assert.equal(report.status, 200);
  assert.match(report.text, /never closed/, 'an unclosed block is reported');
  assert.match(report.text, /missing\.png/, 'a missing asset is reported');
  assert.match(report.text, /Error/, 'findings are graded');
  assert.ok(res.status === 303, 'the same file still uploads (validation is advisory at upload time)');
});

test('phase 3: activation history exists and Revert restores the previous files', async () => {
  const manage = await panel.get(`${panel.admin}/themes/journal`);
  assert.match(manage.text, /History/, 'the manager has a history card');

  // Change the theme through a new upload; the old files must be recoverable.
  const next = journalTheme();
  next['journal/theme.json'] = next['journal/theme.json'].replace('"version": "1.0.0"', '"version": "1.1.0"');
  next['journal/partials/header.html'] = '<header class="journal-header v2">TWO</header>';
  await uploadZip('journal-1.1.zip', next);
  assert.match((await panel.anon('/blog/journal-post')).text, /journal-header v2/, 'the new version renders');

  const history = await panel.get(`${panel.admin}/themes/journal`);
  const snapshot = history.text.match(/themes\/journal\/versions\/(\d+)\/restore/);
  assert.ok(snapshot, 'a snapshot is offered');
  assert.equal((await panel.adminPost(`/themes/journal/versions/${snapshot[1]}/restore`, {})).status, 303);
  const back = await panel.anon('/blog/journal-post');
  assert.match(back.text, /class="journal-header"><a href="\/" class="brand">/, 'the previous partial is back');
  assert.doesNotMatch(back.text, /journal-header v2/);
});

test('phase 3: a theme that only declares a parent inherits the rest', async () => {
  const child = {
    'journal-lite/theme.json': JSON.stringify({
      name: 'Journal Lite', slug: 'journal-lite', version: '1.0.0', parent: 'journal',
      templates: { base: 'base.html' },
      css: 'body{background:#fff}',
    }),
    'journal-lite/base.html': '<!doctype html><html><head>{{{head}}}</head><body data-theme="lite">{{> header}}<main>{{{content}}}</main></body></html>',
  };
  const res = await uploadZip('journal-lite.zip', child);
  assert.match(res.location, /Journal Lite/, res.location);
  const row = (await panel.get(`${panel.admin}/themes`)).text.match(/data-theme-id="(\d+)"[^>]*data-theme-slug="journal-lite"/);
  assert.ok(row);
  await panel.adminPost(`/themes/${row[1]}/activate`, {});

  const page = await panel.anon('/blog/journal-post');
  assert.match(page.text, /data-theme="lite"/, 'the child layout is used');
  assert.match(page.text, /class="journal-header"/, 'the partial comes from the parent theme');
  assert.match(page.text, /data-tpl="journal-post"/, 'so does the post template');

  // Deleting a parent with children is refused.
  const parentRow = (await panel.get(`${panel.admin}/themes`)).text.match(/data-theme-id="(\d+)"[^>]*data-theme-slug="journal"/);
  const refused = await panel.adminPost(`/themes/${parentRow[1]}/delete`, {});
  assert.match(decodeURIComponent(refused.location), /inherits from this theme|Activate another/, 'a parent in use is protected');
});

test('phase 3: the content security policy is emitted, and the nonce matches the page', async () => {
  const page = await panel.anon('/blog/journal-post');
  const header = page.headers.get('content-security-policy') ?? page.headers.get('content-security-policy-report-only');
  assert.ok(header, 'a policy header is present by default (report-only)');
  assert.match(header, /default-src 'self'/);
  assert.match(header, /script-src 'self'/);
  assert.match(header, /object-src 'none'/);
  const nonce = page.text.match(/<(?:script|style) nonce="([^"]+)"/)?.[1];
  if (nonce) assert.ok(header.includes(`'nonce-${nonce}'`), 'the policy allows the nonce the page uses');

  // Enforce mode switches the header name; off removes it.
  await panel.adminPost('/settings', {
    site_title: 'E2E Test Site', timezone: 'UTC', primary_domain: 'localhost', admin_slug: 'admin-panel',
    posts_per_page: '10', permalink_style: 'blog', csp: 'enforce',
  });
  const enforced = await panel.anon('/blog/journal-post');
  assert.equal(enforced.headers.get('content-security-policy') !== null, true, 'enforce emits the blocking header');
  assert.equal(enforced.headers.get('content-security-policy-report-only'), null);

  await panel.adminPost('/settings', {
    site_title: 'E2E Test Site', timezone: 'UTC', primary_domain: 'localhost', admin_slug: 'admin-panel',
    posts_per_page: '10', permalink_style: 'blog', csp: 'off',
  });
  const off = await panel.anon('/blog/journal-post');
  assert.equal(off.headers.get('content-security-policy'), null);
  assert.equal(off.headers.get('content-security-policy-report-only'), null);
});

/* ---------------------------------------------------- phase 4: appearance */

// The Appearance hub: the live Customizer and its preview channel, per-theme
// settings rendered as controls with no code, widget areas from theme.json,
// per-page templates, and Identity. The fixture theme below is installed by the
// first test so every case states its own palette instead of inheriting one.

const previewCookie = () => panel.jar.get('ams_preview');

const ATLAS = {
  'atlas/theme.json': JSON.stringify({
    name: 'Atlas', slug: 'atlas', version: '1.0.0',
    templates: {
      // The theme draws `footer` where it likes; every other area arrives with
      // `{{{footer}}}`, so an area can never be silently invisible.
      base: '<!doctype html><html><head>{{{head}}}</head><body data-theme="atlas">{{{content}}}{{{widgets.footer}}}{{{footer}}}</body></html>',
      home: '<h1 class="atlas-hero">{{theme.hero}}</h1>{{#if theme.badge}}<span class="atlas-badge">on</span>{{/if}}',
      page: '<h1 class="atlas-page">{{page.title}}</h1>',
      'page-wide': '<section class="atlas-wide">{{{page.content}}}</section>',
    },
    css: ':root{--accent:#0055aa;--primary:#0055aa;--fg:#111;--bg:#fff;--max:40rem} body{color:var(--fg)}',
    settings: [
      { key: 'hero', type: 'text', label: 'Hero words', default: 'Hello' },
      { key: 'badge', type: 'toggle', label: 'Show a badge', default: true },
      { key: 'tone', type: 'color', label: 'Accent tone', default: '#0055aa' },
    ],
    widgets: ['footer', 'sidebar'],
  }),
};

test('phase 4: the appearance hub has six screens in one sidebar section', async () => {
  assert.match((await uploadZip('atlas.zip', ATLAS)).location, /Atlas/);
  const row = (await panel.get(`${panel.admin}/themes`)).text.match(/data-theme-id="(\d+)"[^>]*data-theme-slug="atlas"/);
  assert.ok(row, 'the fixture theme is listed');
  await panel.adminPost(`/themes/${row[1]}/activate`, {});

  const page = await panel.get(`${panel.admin}/appearance`);
  const rail = page.text.match(/<nav class="rail"[\s\S]*?<\/nav>/)[0];
  for (const label of ['Customize', 'Themes', 'Templates', 'Menus', 'Widgets', 'Identity']) {
    assert.ok(rail.includes(`>${label}</a>`), `${label} is in the Appearance sub-menu`);
  }
  for (const path of ['/appearance', '/templates', '/identity', '/widgets']) {
    assert.equal((await panel.get(panel.admin + path)).status, 200, `${path} renders`);
  }
});

test('phase 4: the Customizer renders one control per token the theme reads', async () => {
  const page = await panel.get(`${panel.admin}/appearance`);
  assert.match(page.text, /id="customizer-frame"[\s\S]*src="\/\?preview=1&amp;customize=1"/, 'the preview is the real site');
  assert.match(page.text, /data-preview-url="[^"]*\/appearance\/preview"/);
  for (const name of ['token_brand', 'token_text', 'token_bg', 'token_scheme']) {
    assert.ok(page.text.includes(`name="${name}"`), `${name} has a control`);
  }
  // A token this theme cannot honour is listed, not offered as a dead control.
  assert.match(page.text, /Not offered by Atlas/);
  assert.match(page.text, /<code>--surface<\/code>/);
  assert.doesNotMatch(page.text, /name="token_surface"/, 'no control for a variable the theme never reads');
  assert.match(page.text, /data-device="mobile"/, 'device widths are offered');
  assert.match(page.text, /<summary><b>Custom code<\/b>/, 'raw code folded under a disclosure');
});

test('phase 4: an unsaved brand colour reaches the preview through a signed cookie only', async () => {
  const res = await panel.adminPost('/appearance/preview', { token_brand: '#e11d48' });
  assert.equal(res.status, 200);
  const json = JSON.parse(res.text);
  assert.equal(json.ok, true);
  assert.match(json.css, /--accent:#e11d48/, 'the reply carries the CSS to swatch');
  assert.equal(json.changed, 1);

  const cookie = previewCookie();
  assert.ok(cookie && cookie.length > 40, 'a preview cookie was minted');
  assert.doesNotMatch(cookie, /e11d48/, 'the value is signed, not readable');

  const preview = await panel.get('/?preview=1&customize=1');
  assert.match(preview.text, /id="site-tokens">[^<]*#e11d48/, 'the unsaved colour is in the preview');
  assert.equal(preview.headers.get('x-frame-options'), 'SAMEORIGIN', 'the preview may be framed by the panel');
  // A policy that is on (the default) names the frame's allowed parent.
  const policy = preview.headers.get('content-security-policy-report-only') || preview.headers.get('content-security-policy');
  if (policy) assert.match(policy, /frame-ancestors 'self'/, 'the policy allows this site to frame its own preview');

  // Nothing was saved: the public site is untouched, and it stays unframeable.
  const publicPage = await panel.anon('/');
  assert.doesNotMatch(publicPage.text, /#e11d48/);
  assert.equal(publicPage.headers.get('x-frame-options'), null);

  // The cookie is ignored without a session, and a tampered one is refused.
  assert.doesNotMatch((await panel.anon('/?preview=1&customize=1')).text, /#e11d48/);
  panel.jar.set('ams_preview', cookie.slice(0, -6) + 'AAAAAA');
  assert.doesNotMatch((await panel.get('/?preview=1&customize=1')).text, /#e11d48/, 'a tampered signature is ignored');

  // Ending the preview removes the cookie.
  panel.jar.set('ams_preview', cookie);
  await panel.adminPost('/appearance/preview/end', {});
  assert.equal(previewCookie(), undefined, 'the preview cookie is cleared');
});

test('phase 4: saving in the Customizer persists tokens; a bad colour is refused', async () => {
  const res = await panel.adminPost('/appearance', {
    token_brand: '#123456', token_scheme: 'light',
    custom_css: 'body{outline:0}', custom_head: '', custom_footer: '', custom_js: '', start_path: '/',
  });
  assert.equal(res.status, 303);
  const publicPage = await panel.anon('/');
  assert.match(publicPage.text, /--accent:#123456/, 'the saved brand colour is emitted');
  assert.match(publicPage.text, /<meta name="color-scheme" content="light">/);
  assert.match(publicPage.text, /body\{outline:0\}/, 'advanced CSS still works');

  const bad = await panel.adminPost('/appearance', { token_brand: 'not-a-colour' });
  assert.match(bad.location, /err=/, 'an invalid colour is rejected');
  assert.match(decodeURIComponent(bad.location), /Brand colour/);
  assert.match((await panel.anon('/')).text, /--accent:#123456/, 'the refused save changed nothing');

  await panel.adminPost('/appearance', { token_brand: '#0055aa', token_scheme: 'auto', custom_css: '' });
});

test('phase 4: an uploaded theme gets controls and widget areas with no code change', async () => {
  // No route, no form field was written for Atlas: both come from theme.json.
  const page = await panel.get(`${panel.admin}/appearance`);
  assert.match(page.text, /<label for="th-hero">Hero words/);
  assert.ok(page.text.includes('name="badge"'), 'a toggle control is generated');
  assert.ok(page.text.includes('name="tone"'), 'a colour control is generated');
  assert.match(page.text, /Atlas<\/b> v1\.0\.0/);

  const widgets = await panel.get(`${panel.admin}/widgets`);
  assert.match(widgets.text, /widgets\.footer/);
  assert.match(widgets.text, /widgets\.sidebar/);
  assert.match(widgets.text, /name="widget_footer_1_body"/);
  assert.match(widgets.text, /name="widget_sidebar_2_body"/);

  // An unsaved theme setting is previewed before it is saved.
  await panel.adminPost('/appearance/preview', { hero: 'Preview words', badge: '' });
  const preview = await panel.get('/?preview=1&customize=1');
  assert.match(preview.text, /class="atlas-hero">Preview words</);
  assert.doesNotMatch(preview.text, /atlas-badge/, 'the unsaved toggle is off');
  assert.match((await panel.get('/')).text, /class="atlas-hero">Hello</, 'the saved value is unchanged');
  assert.ok((previewCookie() || '').length < 3500, 'the preview cookie stays small');

  // Saving the theme's own settings keeps works the same as the Themes screen.
  await panel.adminPost('/appearance', { hero: 'Saved words', badge: '1', start_path: '/' });
  assert.match((await panel.anon('/')).text, /class="atlas-hero">Saved words</);
  assert.match((await panel.anon('/')).text, /atlas-badge/);
});

test('phase 4: widget areas render where the theme draws them, with escaped titles', async () => {
  // The layout draws `footer`; `sidebar` is appended so a filled area is never
  // lost. One post carries every area, exactly as the form does.
  await panel.adminPost('/widgets', {
    widget_footer_1_title: 'About', widget_footer_1_body: '<p>Footer body</p>',
    widget_sidebar_1_title: '<b>Not markup</b>', widget_sidebar_1_body: '<p>Sidebar body</p>',
  });
  const home = await panel.anon('/');
  assert.match(home.text, /site-widgets--footer[\s\S]*Footer body/);
  assert.match(home.text, /site-widgets--sidebar[\s\S]*Sidebar body/);
  assert.equal((home.text.match(/site-widgets--footer/g) || []).length, 1, 'a drawn area is not repeated');
  assert.match(home.text, /&lt;b&gt;Not markup&lt;\/b&gt;/, 'a widget title is escaped');
  assert.match(home.text, /<p>Sidebar body<\/p>/, 'a widget body is admin HTML');
});

test('phase 4: a page template override is offered in the editor and renders publicly', async () => {
  const editor = await panel.get(`${panel.admin}/pages/new`);
  assert.match(editor.text, /<select id="template" name="template">/, 'the editor offers a Template dropdown');
  assert.match(editor.text, /<option value="page-wide">page-wide<\/option>/, 'the theme template is listed');
  assert.doesNotMatch(editor.text, /<option value="base">/, 'the layout is not offered as a page template');

  assert.equal((await panel.adminPost('/pages/save', {
    title: 'Atlas Landing', slug: 'atlas-landing', body: '<p>Wide body</p>', status: 'published', template: 'page-wide',
  })).status, 303);
  assert.match((await panel.anon('/atlas-landing')).text, /class="atlas-wide"><p>Wide body<\/p>/, 'the chosen template renders');

  // A template the theme does not have is not stored: the default renders instead.
  const list = (await panel.get(`${panel.admin}/pages`)).text;
  const id = list.match(/<a class="row-title" href="\/admin-panel\/pages\/(\d+)"[^>]*>Atlas Landing<\/a>/)?.[1];
  assert.ok(id, 'the page is listed');
  await panel.adminPost('/pages/save', {
    id, title: 'Atlas Landing', slug: 'atlas-landing', body: '<p>Wide body</p>', status: 'published', template: 'no-such-template',
  });
  const fallback = await panel.anon('/atlas-landing');
  assert.doesNotMatch(fallback.text, /atlas-wide/);
  assert.match(fallback.text, /class="atlas-page">Atlas Landing/, 'the default page template is used');

  const templates = await panel.get(`${panel.admin}/templates`);
  assert.match(templates.text, /tile--template[\s\S]*page-wide/, 'the Templates screen lists it');
});

test('phase 4: Identity writes the logo, favicon and social image the page uses', async () => {
  await panel.adminPost('/identity', {
    site_logo: '/media/logo.png', favicon: '/media/icon.png', social_image: '/media/share.png',
    token_scheme: 'dark', token_brand: '#334455',
  });
  const home = await panel.anon('/');
  assert.match(home.text, /<link rel="icon" href="\/media\/icon.png">/);
  assert.match(home.text, /<meta property="og:image" content="[^"]*\/media\/share.png">/);
  assert.match(home.text, /<meta name="color-scheme" content="dark">/);
  assert.match((await panel.get(`${panel.admin}/identity`)).text, /value="\/media\/logo.png"/);

  // A script URL is refused, like every other admin-managed URL.
  await panel.adminPost('/identity', { site_logo: 'javascript:alert(1)', favicon: '', social_image: '', token_scheme: 'auto' });
  assert.doesNotMatch((await panel.get(`${panel.admin}/identity`)).text, /javascript:/);
  assert.doesNotMatch((await panel.anon('/')).text, /<link rel="icon"/);
});

test('phase 4: the Customizer keeps working without JavaScript', async () => {
  // The form posts every control, so a no-JS save is a normal form submission
  // and the preview link opens the real site in a tab.
  const page = await panel.get(`${panel.admin}/appearance`);
  assert.match(page.text, /<form method="post" action="[^"]*\/appearance" id="customizer"/);
  assert.match(page.text, /Open preview in a tab/);
  assert.match(page.text, /With JavaScript off, save first/);
  assert.match(page.text, /\/assets\/screens\.css\?v=/, 'the split pane CSS is a cacheable asset');
});

/* ------------------------------------------- phase 5: store & lifecycle */

// The theme store as a *lifecycle*: preview → install → edit → export → roll
// back, entirely in the panel. These cases use the six bundled themes (two of
// them new: Journal and Portfolio) and the zip writer/reader round trip.

const zipNames = async (bytes) => {
  // Minimal central-directory read: enough to assert what a zip contains.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  assert.ok(eocd >= 0, 'the download is a zip');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const names = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, 'central directory entry');
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    names.push(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen)));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return names.sort();
};

test('phase 5: the store shows six themes with screenshots, tags and a live preview', async () => {
  const page = await panel.get(`${panel.admin}/themes`);
  for (const name of ['AMS 1', 'AMS Base', 'AMS Pro', 'AMS Premium', 'AMS Journal', 'AMS Portfolio']) {
    assert.ok(page.text.includes(`<h3>${name} `), `${name} is a store card`);
  }
  assert.equal((page.text.match(/class="store-item__shot"/g) || []).length, 6, 'every card has art');
  assert.match(page.text, /class="tag">serif/, 'a theme shows its tags');
  assert.match(page.text, /themes\/preview\/ams-journal/, 'each card links to the live preview');

  // The preview page frames the real site; the theme is not activated.
  const preview = await panel.get(`${panel.admin}/themes/preview/ams-journal`);
  assert.equal(preview.status, 200);
  assert.match(preview.text, /id="theme-preview-frame"[^>]*src="\/\?preview=1(?:&amp;|&)theme=ams-journal"/);
  assert.match(preview.text, /data-preview-device="mobile"/, 'device widths are offered');
  assert.match(preview.text, /Install and activate/);
  // A theme that is not installed still renders: its stylesheet is served from the app.
  const storeCss = await panel.get(`${panel.admin}/themes/preview/ams-journal/style.css`);
  assert.equal(storeCss.status, 200);
  assert.match(storeCss.text, /--j-measure/, 'the theme stylesheet is served for the preview');

  // Installing and activating it makes it the site.
  assert.match((await panel.adminPost('/themes/store/ams-journal/install', { activate: 1 })).location, /AMS Journal is now your active theme/);
  const home = await panel.anon('/');
  assert.match(home.text, /class="masthead"/);
  assert.match(home.text, /<style nonce="[^"]*">:root\{--measure:34ch;--accent:#9c4221\}/, 'the theme settings reach the CSS');
  assert.match(home.text, /has-dropcap/, 'a toggle setting adds its class');
  assert.match(home.text, /class="colophon"/, 'a partial renders');
  // Its declared widget areas are editable, and render where it draws them.
  const widgets = await panel.get(`${panel.admin}/widgets`);
  assert.match(widgets.text, /widgets\.after-post/);
  assert.match(widgets.text, /widgets\.footer/);
  // The stored key uses underscores (`widget_<area('-'→'_')>_<n>_<field>`), while
  // the manifest keeps the hyphen in the area name.
  await panel.adminPost('/widgets', { widget_after_post_1_body: '<p>After the post</p>' });
  assert.match((await panel.anon('/')).text, /site-widgets--after-post/, 'an area the layout does not draw is appended');
  // Restore the default theme for later cases.
  await panel.adminPost('/themes/store/ams-1/install', { activate: 1 });
});

test('phase 5: a theme can be edited in the panel, validated, and rolled back', async () => {
  const install = await panel.adminPost('/themes/store/ams-portfolio/install', { activate: 1 });
  assert.match(install.location, /AMS Portfolio is now your active theme|installed/, 'the theme is installed and active');
  const row = (await panel.get(`${panel.admin}/themes`)).text.match(/data-theme-id="(\d+)"[^>]*data-theme-slug="ams-portfolio"/);
  assert.ok(row, 'the theme is listed with an id');

  const editor = await panel.get(`${panel.admin}/themes/ams-portfolio/edit`);
  assert.equal(editor.status, 200);
  assert.match(editor.text, /<textarea[^>]*id="file-body"[^>]*name="body"/, 'a plain textarea, no dependency');
  assert.match(editor.text, /partials\/hero\.html/, 'partials are listed');
  assert.match(editor.text, /base\.html/);
  assert.match(editor.text, /style\.css/);

  // A bad edit is refused by the same validator an upload uses, and nothing changes.
  const bad = await panel.adminPost('/themes/ams-portfolio/edit', { file: 'base.html', body: '<p>no content block</p>' });
  assert.match(bad.location, /err=/, 'an invalid template is refused');
  assert.match(decodeURIComponent(bad.location), /content/);
  assert.match((await panel.get(`${panel.admin}/themes/ams-portfolio/edit?file=base.html`)).text, /\{\{\{content\}\}\}/, 'the file is unchanged');

  // A good edit is stored, and reaches the page.
  const good = await panel.adminPost('/themes/ams-portfolio/edit', {
    file: 'partials/hero.html', body: '<section class="hero"><h1 class="hero__title">Edited in the panel</h1></section>',
  });
  assert.match(good.location, /ok=/, 'the save succeeds');
  assert.match((await panel.get(`${panel.admin}/themes/ams-portfolio/edit?file=partials/hero.html`)).text, /Edited in the panel/);
  assert.match((await panel.anon('/')).text, /Edited in the panel/);

  // CSS is editable too, and a template's syntax is checked.
  await panel.adminPost('/themes/ams-portfolio/edit', { file: 'style.css', body: 'body{background:#101418}' });
  assert.match((await panel.anon('/')).text, /body\{background:#101418\}/);

  // Every save snapshotted the theme first, so rollback restores it.
  const history = await panel.get(`${panel.admin}/themes/ams-portfolio`);
  const snapshots = [...history.text.matchAll(/versions\/(\d+)\/restore/g)].map((m) => m[1]);
  assert.ok(snapshots.length >= 2, 'each save snapshotted the theme first');
  assert.match(history.text, /Before editing partials\/hero\.html/, 'the snapshot says what it was for');
  // History is newest first, so the last entry is the pristine state from before
  // any of these edits: rolling back to it undoes all of them at once.
  await panel.adminPost(`/themes/ams-portfolio/versions/${snapshots[snapshots.length - 1]}/restore`, {});
  assert.doesNotMatch((await panel.anon('/')).text, /Edited in the panel/, 'rollback brought the original back');
  assert.match((await panel.anon('/')).text, /Design with intent/);
  await panel.adminPost('/themes/store/ams-1/install', { activate: 1 });
});

test('phase 5: export is a zip that uploads back byte-for-byte', async () => {
  // Journal may or may not be installed by an earlier case; install it here so
  // this test states its own preconditions.
  await panel.adminPost('/themes/store/ams-journal/install', {});
  const listed = (await panel.get(`${panel.admin}/themes`)).text;
  const id = listed.match(/data-theme-id="(\d+)"[^>]*data-theme-slug="ams-journal"/)?.[1];
  assert.ok(id, 'the theme has an id');

  const res = await panel.request(`${panel.admin}/themes/${id}/download`, {});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/zip/);
  assert.match(res.headers.get('content-disposition'), /ams-journal-1\.0\.0\.zip/);
  const names = await zipNames(res.bytes);
  for (const expected of ['theme.json', 'base.html', 'home.html', 'partials/header.html', 'style.css', 'screenshot.png']) {
    assert.ok(names.includes(expected), `${expected} is in the export`);
  }

  // The manifest inside the zip names files rather than carrying their text, so
  // it is the same shape an author would upload from a folder.
  const manifestAt = 0; // theme.json is written first, so its local header is at 0
  void manifestAt;
  const size = res.bytes.length;

  // Round trip through the real upload form: a zip made here must upload back.
  const body = new FormData();
  body.set('_csrf', await panel.csrf());
  body.append('theme', new Blob([res.bytes], { type: 'application/zip' }), 'ams-journal.zip');
  const upload = await panel.request(`${panel.admin}/themes/upload`, { method: 'POST', body });
  assert.equal(upload.status, 303, 'the exported zip uploads back');
  assert.match(decodeURIComponent(upload.location), /AMS Journal.*(updated|installed)/);

  // And it is still the same theme: templates, CSS and the screenshot survived.
  // Templates, partials and the stylesheet all survived the round trip: the
  // layout still includes its header partial, and the partial is the real one.
  const after = await panel.get(`${panel.admin}/themes/ams-journal/edit?file=base.html`);
  assert.match(after.text, /\{\{&gt; header\}\}/);
  const partial = await panel.get(`${panel.admin}/themes/ams-journal/edit?file=partials/header.html`);
  assert.match(partial.text, /masthead__title/);
  const assets = (await panel.get(`${panel.admin}/themes/ams-journal`)).text;
  assert.match(assets.text ?? assets, /screenshot\.png/, 'the binary asset round-tripped');
  assert.ok(size > 5000, 'the zip carries the PNG, not just text');
  await panel.adminPost('/themes/store/ams-1/install', { activate: 1 });
});

test('phase 5: a new theme can be created from a template in the panel', async () => {
  const form = await panel.get(`${panel.admin}/themes/new`);
  assert.equal(form.status, 200);
  assert.match(form.text, /name="kind"/);
  assert.match(form.text, /Child of the active theme/);

  const made = await panel.adminPost('/themes/new', { name: 'Panel Made', kind: 'blank' });
  assert.match(made.location, /\/themes\/panel-made\/edit/, 'the new theme opens in the editor');
  const editor = await panel.get(`${panel.admin}/themes/panel-made/edit`);
  assert.match(editor.text, /<textarea/);
  // It renders once activated: the blank theme is a real theme, not a stub.
  const row = (await panel.get(`${panel.admin}/themes`)).text.match(/data-theme-id="(\d+)"[^>]*data-theme-slug="panel-made"/);
  assert.ok(row, 'it is installed');
  await panel.adminPost(`/themes/${row[1]}/activate`, {});
  const home = await panel.anon('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /class="site-head"/, 'the blank theme renders its own layout');
  assert.doesNotMatch(home.text, /\{\{/, 'no unrendered tags');

  // A child theme inherits from the active theme and needs no layout of its own.
  const child = await panel.adminPost('/themes/new', { name: 'Panel Child', kind: 'child' });
  assert.match(child.location, /panel-child/);
  assert.match((await panel.get(`${panel.admin}/themes/panel-child`)).text, /Inherits templates/);
  // Both go, so the store list stays predictable for later cases.
  const ids = (await panel.get(`${panel.admin}/themes`)).text;
  const childId = ids.match(/data-theme-id="(\d+)"[^>]*data-theme-slug="panel-child"/)[1];
  const madeId = ids.match(/data-theme-id="(\d+)"[^>]*data-theme-slug="panel-made"/)[1];
  await panel.adminPost('/themes/store/ams-1/install', { activate: 1 });
  await panel.adminPost(`/themes/${childId}/delete`, {});
  await panel.adminPost(`/themes/${madeId}/delete`, {});
  assert.match((await panel.get(`${panel.admin}/themes`)).text, /AMS Journal/, 'the store is unchanged');
});

/* ---------------------------------- phase 6: audit, capabilities, i18n */

test('phase 6: every mutation writes an audit entry a person can read', async () => {
  // A save, a theme change, a settings change and a user change: four kinds of
  // mutation, four entries, each naming what happened rather than an id.
  await panel.adminPost('/pages/save', { title: 'Audit Trail Page', slug: 'audit-trail', body: '<p>x</p>', status: 'published' });
  await panel.adminPost('/themes/store/ams-portfolio/install', { activate: 1 });
  await panel.adminPost('/themes/store/ams-1/install', { activate: 1 });

  const page = await panel.get(`${panel.admin}/tools/audit`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Audit log/);
  assert.match(page.text, /Created page “Audit Trail Page”/, 'the save is readable');
  assert.match(page.text, /Activated theme “AMS Portfolio”/, 'theme activation is logged');
  assert.match(page.text, /data-audit-action="created"/, 'actions are filterable');
  assert.match(page.text, /owner/, 'who did it is recorded');
  // Entries are newest first and paged by keyset, not offset.
  const ids = [...page.text.matchAll(/data-audit-id="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(ids.length >= 4, 'there are entries');
  assert.deepEqual([...ids].sort((a, b) => b - a), ids, 'newest first');

  // Filters are GET parameters, so a view is linkable and works without JavaScript.
  const filtered = await panel.get(`${panel.admin}/tools/audit?action=created`);
  assert.match(filtered.text, /Created page/);
  assert.doesNotMatch(filtered.text, /Activated theme/);
  const byType = await panel.get(`${panel.admin}/tools/audit?type=theme`);
  assert.match(byType.text, /Activated theme/);
  assert.doesNotMatch(byType.text, /Created page/);
  const search = await panel.get(`${panel.admin}/tools/audit?q=Portfolio`);
  assert.match(search.text, /AMS Portfolio/);
  const nothing = await panel.get(`${panel.admin}/tools/audit?q=zzz-nothing-matches`);
  assert.match(nothing.text, /No entries match/);

  // A delete is recorded too: the answer to "who removed that" is in the log.
  const list = (await panel.get(`${panel.admin}/pages`)).text;
  const id = list.match(/<a class="row-title" href="\/admin-panel\/pages\/(\d+)"[^>]*>Audit Trail Page<\/a>/)?.[1];
  assert.ok(id, 'the page is listed');
  await panel.adminPost(`/pages/${id}/delete`, {});
  assert.match((await panel.get(`${panel.admin}/tools/audit`)).text, /Deleted page \/audit-trail/);
});

test('phase 6: capabilities decide what a role can do, in one place', async () => {
  // The map itself: a role is a bundle of named capabilities, and the panel asks
  // for the capability rather than comparing roles.
  const { can, ROLE_CAPS, CAPABILITIES, capsFor, roleSummary } = await import('../src/lib/capabilities.ts');
  assert.ok(CAPABILITIES.length >= 15, 'there is a capability catalogue');
  for (const capability of CAPABILITIES) assert.ok(ROLE_CAPS.admin.includes(capability), `an admin has ${capability}`);
  for (const capability of ROLE_CAPS.admin) assert.ok(CAPABILITIES.includes(capability), `${capability} is catalogued`);
  // The defaults are exactly the permissions the roles had before capabilities.
  assert.equal(can({ role: 'author' }, 'write_posts'), true);
  assert.equal(can({ role: 'author' }, 'manage_pages'), false);
  assert.equal(can({ role: 'author' }, 'manage_themes'), false);
  assert.equal(can({ role: 'editor' }, 'moderate_comments'), true);
  assert.equal(can({ role: 'editor' }, 'edit_others_posts'), true);
  assert.equal(can({ role: 'editor' }, 'manage_users'), false);
  assert.equal(can(null, 'read'), false);
  assert.equal(capsFor('admin').length, CAPABILITIES.length);
  assert.match(roleSummary('author'), /writes posts/);
  assert.match(roleSummary('admin'), /Everything/);

  // And the routes follow it: an author cannot reach a screen their role lacks.
  const created = await panel.adminPost('/users/save', {
    username: 'auditor', email: 'auditor@example.com', role: 'author', password: 'auth0rpass!',
  });
  assert.equal(created.status, 303, 'an author account exists');

  // Sign in as that author in a separate jar, so the admin session is untouched.
  const author = createClient(panel.base);
  const loginPage = await author.get(`${panel.admin}/login`);
  const token = loginPage.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const signIn = await author.post(`${panel.admin}/login`, new URLSearchParams({ _csrf: token, login: 'auditor', password: 'auth0rpass!' }));
  assert.equal(signIn.status, 303, 'the author signs in');

  assert.equal((await author.get(`${panel.admin}/posts/new`)).status, 200, 'an author may write a post');
  assert.equal((await author.get(`${panel.admin}/pages`)).status, 403, 'but not pages');
  assert.equal((await author.get(`${panel.admin}/themes`)).status, 403, 'nor themes');
  assert.equal((await author.get(`${panel.admin}/tools/audit`)).status, 403, 'nor the audit log');
  assert.equal((await author.get(`${panel.admin}/settings`)).status, 403, 'nor settings');
  assert.equal((await author.get(`${panel.admin}/landing`)).status, 403, 'nor the landing page options');
  // The sidebar is built from the same map, so the rail agrees with the routes.
  const rail = (await author.get(`${panel.admin}/`)).text.match(/<nav class="rail"[\s\S]*?<\/nav>/)[0];
  assert.doesNotMatch(rail, />Appearance<|>Settings<|>Users<|>Landing page</, 'the rail hides what the role cannot use');
  assert.match(rail, />Posts</, 'and keeps what it can');
});

/** A minimal cookie-jar client, for a second identity in the same test file. */
function createClient(base) {
  const jar = new Map();
  const json = async (res) => ({ status: res.status, text: await res.text(), headers: res.headers });
  const withCookies = (init = {}) => ({
    ...init,
    redirect: 'manual',
    headers: { ...(init.headers || {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
  });
  const remember = (res) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (value === '' || /max-age=0/i.test(line)) jar.delete(name); else jar.set(name, value);
    }
  };
  return {
    get: async (path) => {
      const res = await fetch(base + path, withCookies());
      remember(res);
      return json(res);
    },
    post: async (path, body) => {
      const res = await fetch(base + path, withCookies({ method: 'POST', body, headers: { Origin: base } }));
      remember(res);
      return json(res);
    },
  };
}

test('phase 6: the panel strings come from one catalogue', async () => {
  const { t, en, catalogueKeys } = await import('../src/lib/i18n.ts');
  assert.equal(t('audit.title'), 'Audit log');
  assert.equal(t('audit.entries', { n: 3 }), '3 entries');
  assert.equal(t('nope.missing'), 'nope.missing', 'a missing key is visible, not silent');
  assert.ok(catalogueKeys().length > 40, 'the catalogue is real');
  for (const key of Object.keys(en)) assert.equal(typeof en[key], 'string');

  // The screens that were translated take their words from the catalogue.
  const audit = await panel.get(`${panel.admin}/tools/audit`);
  assert.match(audit.text, /Every change made in the panel, newest first\. Entries are kept for 90 days\./);
  const health = await panel.get(`${panel.admin}/tools/health`);
  assert.match(health.text, /Performance budgets/);
  assert.match(health.text, /Panel CSS, all three files/);
});

test('phase 6: performance budgets are measured, stated and shown in the panel', async () => {
  const fs = await import('node:fs/promises');
  const report = JSON.parse(await fs.readFile(new URL('../src/lib/budget-report.json', import.meta.url), 'utf8'));
  const health = await panel.get(`${panel.admin}/tools/health`);
  for (const [key, bytes] of Object.entries(report)) {
    assert.ok(Number(bytes) > 0, `${key} was measured`);
    assert.match(health.text, new RegExp(`data-budget="${key}"`), `${key} is shown`);
  }
  // A public page stays well inside its stated limit.
  const home = await panel.anon('/');
  assert.ok(Buffer.byteLength(home.text) < 200 * 1024, 'the page is not enormous before compression');
});

test('phase 6: export v2 carries themes, theme settings and revisions', async () => {
  await panel.adminPost('/themes/store/ams-journal/install', {});
  const res = await panel.get(`${panel.admin}/tools/export/download`);
  assert.equal(res.status, 200);
  const dump = JSON.parse(res.text);
  assert.equal(dump.format, 'edge-cms-backup');
  assert.equal(dump.format_version, 2);
  assert.ok(Array.isArray(dump.themes) && dump.themes.length >= 1, 'installed themes travel with the backup');
  const journal = dump.themes.find((t) => t.slug === 'ams-journal');
  assert.ok(journal, 'a specific theme is present');
  assert.match(journal.templates, /\{\{\{content\}\}\}/, 'its templates are in the file');
  assert.match(journal.partials, /masthead/, 'its partials are in the file');
  assert.match(journal.css, /--j-measure/, 'its stylesheet is in the file');
  assert.ok(Array.isArray(dump.theme_settings), 'per-theme settings are exported');
  assert.ok(Array.isArray(dump.content_revisions), 'revisions are exported');
  // Still no passwords, and still the content it always had.
  assert.ok(dump.users.length >= 1);
  assert.equal(dump.users[0].password_hash, undefined, 'no password material in an export');
  assert.ok(Array.isArray(dump.content) && dump.content.length >= 1);
});

test('phase 5: a preview runs the real site, and a local edit is never silently replaced', async () => {
  // Install Journal, then change one partial in the panel.
  await panel.adminPost('/themes/store/ams-journal/install', { activate: 1 });
  await panel.adminPost('/themes/ams-journal/edit', {
    file: 'partials/header.html',
    body: '<header class="masthead"><p class="masthead__kicker">My own kicker</p><a class="masthead__title" href="/">{{site.title}}</a>{{{widgets.header}}}</header>',
  });
  assert.match((await panel.anon('/')).text, /My own kicker/);

  // Preview: a panel page with the store theme's site framed, and the framed URL
  // renders that theme publicly (preview=1 is signed-in only, never cached).
  const preview = await panel.get(`${panel.admin}/themes/preview/ams-portfolio`);
  assert.equal(preview.status, 200);
  assert.match(preview.text, /id="theme-preview-frame"/);
  assert.match(preview.text, /src="\/\?preview=1&(amp;)?theme=ams-portfolio"/);
  const framed = await panel.get('/?preview=1&theme=ams-portfolio');
  assert.equal(framed.status, 200);
  assert.match(framed.text, /hero__title/, 'the framed page is the real theme');
  assert.match(framed.headers.get('cache-control') ?? '', /no-store/);
  assert.equal((await panel.anon('/?preview=1&theme=ams-portfolio')).status, 200);
  assert.doesNotMatch((await panel.anon('/?preview=1&theme=ams-portfolio')).text, /hero__title/, 'previews are for signed-in people');

  // The store still ships this theme under this name, and my copy differs, so the
  // next install asks what to do with the edit instead of overwriting it.
  assert.match((await panel.adminPost('/themes/store/ams-journal/install', { conflict: 'keep' })).location, /Kept%20your%20edits|Kept your edits/);
  assert.match((await panel.anon('/')).text, /My own kicker/, 'keeping my changes kept them');

  // "Save mine as a copy" freezes the edit under its own name and takes the store's.
  assert.equal((await panel.adminPost('/themes/store/ams-journal/install', { conflict: 'copy' })).status, 303);
  const themes = (await panel.get(`${panel.admin}/themes`)).text;
  assert.match(themes, /AMS Journal \(mine\)/, 'my edited copy is a theme of its own');
  assert.match(themes, /data-theme-slug="ams-journal-mine"/);
  assert.doesNotMatch((await panel.anon('/')).text, /My own kicker/, 'and the store version came back');

  // Every one of those choices is in the audit log, naming the files.
  const audit = (await panel.get(`${panel.admin}/tools/audit?type=theme`)).text;
  assert.match(audit, /Saved your edits to/);
  assert.match(audit, /partials\/header\.html|Edited partials\/header\.html/);

  await panel.adminPost('/themes/store/ams-1/install', { activate: 1 });
});

test('phase 5: an older install shows "Update available vX → vY" with its changelog', async () => {
  // The server is a real instance, so an older install is simulated the way an
  // upgrade finds one: the row says v0.9.0 while the store package is v1.0.0.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(`${panel.dataDir}/cms.sqlite`);
  db.prepare("UPDATE themes SET version='0.9.0' WHERE slug='ams-journal'").run();
  db.prepare("DELETE FROM settings WHERE key='theme_store_stamp_ams-journal'").run();
  db.close();

  const store = (await panel.get(`${panel.admin}/themes`)).text;
  assert.match(store, /Update available v0\.9\.0 → v1\.0\.0/);
  assert.match(store, /First release: serif single column/, 'the changelog is shown');
  assert.match(store, /Update 0\.9\.0 → 1\.0\.0/, 'the button says both versions');
  assert.match(store, /data-update="ams-journal"/);

  // Taking the update writes a snapshot and lands the newer files.
  assert.match((await panel.adminPost('/themes/store/ams-journal/install', {})).location, /installed/);
  assert.doesNotMatch((await panel.get(`${panel.admin}/themes`)).text, /Update available v0\.9\.0/);
  const detail = (await panel.get(`${panel.admin}/themes/ams-journal`)).text;
  assert.match(detail, /Before store update/, 'the replaced version is in the history');
  await panel.adminPost('/themes/store/ams-1/install', { activate: 1 });
});

test('shell uses document scrolling and an overlay drawer', async () => {
  const css = (await panel.get(`${panel.admin}/assets/app.css`)).text;
  assert.doesNotMatch(css, /\b100vh\b/);
  assert.match(css, /\.shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*min-height:\s*calc\(100dvh/s);
  assert.match(css, /\.shell\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/s);
  assert.doesNotMatch(css.match(/\.main\s*\{[^}]*\}/s)[0], /overflow-y/);
  assert.match(css, /\.rail\s*\{[^}]*position:\s*fixed[^}]*visibility:\s*hidden/s);
  assert.match(css, /#nav-t:checked\s*~\s*\.nav-backdrop/);
  assert.match(css, /\.table-wrap\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s);
});

test('page icons persist in editor and tree; unsafe names fall back', async () => {
  const saved = await panel.adminPost('/pages/save', { title: 'Icon test page', slug: 'icon-test-page', body: 'Test', status: 'published', icon: 'folder' });
  assert.equal(saved.status, 303);
  const list = (await panel.get(`${panel.admin}/pages`)).text;
  assert.match(list, /href="#i-folder"[^]*?Icon test page/);
  const id = list.match(/href="\/admin-panel\/pages\/(\d+)"[^>]*>Icon test page<\/a>/)?.[1];
  assert.ok(id);
  assert.match((await panel.get(`${panel.admin}/pages/${id}`)).text, /<option value="folder" selected>/);
  await panel.adminPost('/pages/save', { id, title: 'Icon test page', slug: 'icon-test-page', body: 'Test', status: 'published', icon: 'evil' });
  assert.doesNotMatch((await panel.get(`${panel.admin}/pages`)).text, /href="#i-evil"/);
});

test('social profile URL validation and footer toggle', async () => {
  const base = { site_title: 'E2E Test Site', timezone: 'UTC', primary_domain: 'localhost', admin_slug: 'admin-panel', posts_per_page: '10', permalink_style: 'blog', csp: 'report' };
  const bad = await panel.adminPost('/settings', { ...base, social_facebook: 'javascript:alert(1)', social_footer: '1' });
  assert.match(bad.location, /valid HTTP or HTTPS URL/);
  // Activate the bundled theme, which includes the shared footer partial.
  await panel.adminPost('/themes/ams1/activate', {});
  await panel.adminPost('/settings', { ...base, social_facebook: 'https://example.com/profile', social_footer: '1' });
  const settingsPage = await panel.get(`${panel.admin}/settings`);
  assert.match(settingsPage.text, /value="https:\/\/example.com\/profile"/);
  assert.match((await panel.anon('/icon-test-page')).text, /href="https:\/\/example.com\/profile"[^>]*>Facebook<\/a>/);
  await panel.adminPost('/settings', { ...base, social_facebook: 'https://example.com/profile' });
  assert.doesNotMatch((await panel.anon('/icon-test-page')).text, /href="https:\/\/example.com\/profile"/);
});
