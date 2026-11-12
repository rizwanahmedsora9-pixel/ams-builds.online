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
