// System screens, over HTTP against a real server:
//
//   1. the factory reset - "we built the site wrong, start again from zero"
//   2. the database password - DB_PASSWORD, which the Node server checks before
//      it listens, and the file permissions that protect the SQLite file
//
// Both boot their own server so neither interferes with the long story in
// tests/e2e.mjs. The database password is a Node-runtime feature (on Cloudflare
// the database is D1, reached only through the Worker binding), so those tests
// skip themselves when the suite runs against wrangler.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN, TARGET, createHarness } from './helpers.mjs';

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const log = (msg) => console.log(`    · ${msg}`);
const health = async (h) => JSON.parse((await h.anon('/api/health')).text);
const onNode = TARGET === 'node';

/* ------------------------------------------------------- factory reset */

const harness = createHarness();
let admin = '/admin-panel';

before(async () => {
  await harness.start();
  admin = (await harness.install()).admin;
});

after(async () => {
  await harness.stop();
  harness.cleanup();
  await lock.stop();
  // Never started when the whole section skipped itself (Cloudflare target).
  if (lock.dataDir) lock.cleanup();
});

test('a small site exists to lose: pages, a post, media and a redirect', async () => {
  const { anon, adminPost, request, csrf } = harness;
  assert.match((await adminPost('/pages/save', { title: 'Legacy Page', slug: 'legacy-page', body: '<p>Who we are.</p>', status: 'published' })).location, /ok=/);
  assert.match((await adminPost('/posts/save', { title: 'First post', body: '<p>Hello.</p>', status: 'published' })).location, /ok=/);
  const theme = new FormData();
  theme.set('_csrf', await csrf());
  theme.set('theme', new File([JSON.stringify({ name: 'Old Test Theme', version: '1.0', templates: { base: '<html><body>{{{content}}}</body></html>' } })], 'old-theme.json', { type: 'application/json' }));
  assert.match((await request(`${admin}/themes/upload`, { method: 'POST', body: theme })).location, /Old Test Theme/);
  assert.match((await harness.get(`${admin}/themes`)).text, /data-theme-slug="old-test-theme"/);
  const body = new FormData();
  body.set('_csrf', await csrf());
  body.append('files', new File([PNG], 'team.png', { type: 'image/png' }));
  assert.match((await request(`${admin}/media/upload`, { method: 'POST', body })).location, /1 file uploaded/);
  assert.match((await adminPost('/tools/redirects', { from_path: '/old', to_url: '/legacy-page', status: '301' })).location, /saved/);
  assert.equal((await anon('/legacy-page')).status, 200);
  assert.equal((await anon('/old')).status, 301);
  log('a page, a post, an upload and a redirect are live on the public site');
});

test('the reset button is in Tools, and the screen counts what it will destroy', async () => {
  const { get } = harness;
  const tools = await get(`${admin}/tools`);
  assert.match(tools.text, /Danger zone/);
  assert.ok(tools.text.includes(`href="${admin}/tools/reset"`), 'the danger zone links to the reset screen');

  const page = await get(`${admin}/tools/reset`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Reset the panel/);
  assert.match(page.text, /This cannot be undone\./);
  assert.match(page.text, /<dt>Pages<\/dt><dd>2<\/dd>/, 'the starter home and the Legacy page');
  assert.match(page.text, /<dt>Posts<\/dt><dd>1<\/dd>/);
  assert.match(page.text, /<dt>Media files<\/dt><dd>1<\/dd>/);
  assert.match(page.text, /<dt>Panel accounts, including yours<\/dt><dd>1<\/dd>/);
  assert.match(page.text, /<dt>Redirects<\/dt><dd>1<\/dd>/);
  assert.match(page.text, /the audit log/i, 'it says the log goes too');
  assert.ok(page.text.includes(`${admin}/tools/export/download`), 'it offers an export first');
  assert.match(page.text, /name="current_password"[^]*required/, 'the panel password is required');
  assert.match(page.text, /name="confirm"[^]*required/, 'the typed word is required');
  assert.match(page.text, /data-confirm="/, 'JavaScript adds a confirmation dialog on top');
  assert.match(page.text, /data-reset-submit/, 'and keeps the button off until the word is typed');
  log('Tools -> Danger zone -> a screen that counts pages, posts, media, accounts and redirects');
});

test('a reset needs the word, the password and an admin', async () => {
  const { get, anon, adminPost } = harness;
  const stillThere = async () => assert.equal((await anon('/legacy-page')).status, 200, 'the site is untouched');

  assert.match((await adminPost('/tools/reset', { current_password: ADMIN.password, confirm: 'nope' })).location, /err=Type RESET/);
  await stillThere();
  assert.match((await adminPost('/tools/reset', { current_password: ADMIN.password, confirm: '' })).location, /err=Type RESET/);
  await stillThere();
  assert.match((await adminPost('/tools/reset', { current_password: 'not my password', confirm: 'RESET' })).location, /err=Your panel password/);
  await stillThere();

  // An author can reach the panel but not this screen, and not the action.
  assert.match((await adminPost('/users/save', {
    username: 'author-reset', email: 'author-reset@example.com', role: 'author', password: 'author password',
  })).location, /can.now.sign.in/);
  await adminPost('/login', { login: 'author-reset', password: 'author password' });
  assert.equal((await get(`${admin}/tools/reset`)).status, 403, 'authors cannot open the reset screen');
  assert.equal((await adminPost('/tools/reset', { current_password: 'author password', confirm: 'RESET' })).status, 403, 'authors cannot reset');
  await stillThere();
  await adminPost('/login', { login: ADMIN.username, password: ADMIN.password });
  assert.equal((await get(admin)).status, 200, 'signed back in as the admin');
  log('wrong word, wrong password and a non-admin are all refused with the site intact');
});

test('resetting wipes everything and reopens the installer', async () => {
  const { anon } = harness;
  const res = await harness.adminPost('/tools/reset', { current_password: ADMIN.password, confirm: 'RESET' });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/install', 'the admin is sent straight to the installer');
  assert.match(res.headers.get('set-cookie') || '', /cms_session=;/, 'the session cookie is cleared');

  const state = await health(harness);
  assert.equal(state.ok, true, 'the same process keeps serving');
  assert.equal(state.installed, false, 'the install lock went with the reset');
  assert.deepEqual(state.checks, { database: true, keyvalue: true, media: true }, 'storage still answers');

  assert.equal((await anon('/install')).status, 200);
  assert.match((await anon('/install')).text, /Install your site/);
  for (const path of ['/', '/about', '/old', '/api/posts', admin, `${admin}/tools/reset`]) {
    const page = await anon(path);
    assert.equal(page.status, 302, path);
    assert.equal(page.location, '/install', `every URL leads back to the installer: ${path}`);
  }
  if (onNode) {
    assert.deepEqual(readdirSync(join(harness.dataDir, 'media')), [], 'the media folder is empty');
    assert.ok(statSync(join(harness.dataDir, 'cms.sqlite')).size >= 0, 'the database file stays; its tables do not');
  }
  log('installer open again, every URL redirected, uploads and the session gone');
});

test('the site can be installed again from zero', async () => {
  const { get, anon } = harness;
  const again = await harness.install({ slug: 'fresh-panel', title: 'Fresh Start' });
  assert.equal(again.admin, '/fresh-panel');
  assert.equal((await health(harness)).installed, true);

  const fresh = (await anon('/')).text;
  assert.match(fresh, /Welcome to Fresh Start/, 'the sample home page is the only content');
  // A fresh install is the default theme: it ships a layout for every page,
  // and its navigation and footer come with it.
  assert.match(fresh, /class="site-header"/, 'the bundled theme is the theme a new site starts with');
  assert.match(fresh, /href="\/theme-assets\/ahmed-pro-theme\/style\.css/, 'and it is Ahmed Pro Theme');
  assert.match(fresh, /class="site-footer__inner"/, 'with its footer columns');
  assert.equal((await anon('/theme-assets/ahmed-pro-theme/static/js/theme.js')).status, 200, 'and its script was written again');
  assert.equal((await anon('/legacy-page')).status, 404, 'the old page did not come back');
  assert.equal((await anon('/old')).status, 404, 'the old redirect did not come back');
  assert.equal((await anon('/admin-panel')).status, 404, 'the old admin URL is not the panel any more');
  assert.equal((await get('/fresh-panel')).status, 200);
  assert.equal(JSON.parse((await anon('/api/posts')).text).total, 0, 'no demo posts return after reset');
  const themes = (await get('/fresh-panel/themes')).text;
  assert.match(themes, /No uploaded themes/, 'no theme is installed');
  assert.doesNotMatch(themes, /data-theme-slug=|data-store-theme=/, 'no old or store theme cards are shown');
  assert.match(themes, /Upload a theme/, 'owners can upload their own theme');
  const newTheme = new FormData();
  newTheme.set('_csrf', await harness.csrf());
  newTheme.set('theme', new File([JSON.stringify({ name: 'My Theme', version: '1.0', templates: { base: '<html><body data-mine="yes">{{{content}}}</body></html>' } })], 'mine.json', { type: 'application/json' }));
  assert.match((await harness.request('/fresh-panel/themes/upload', { method: 'POST', body: newTheme })).location, /My Theme/);
  const uploaded = (await get('/fresh-panel/themes')).text.match(/data-theme-id="(\d+)" data-theme-slug="my-theme"/);
  assert.ok(uploaded, 'a new theme can be uploaded');
  await harness.adminPost(`/themes/${uploaded[1]}/activate`, {});
  assert.match((await anon('/')).text, /data-mine="yes"/, 'the uploaded theme can be activated');
  assert.match((await get('/fresh-panel/media')).text, /No media items found/, 'the library is empty');
  assert.match((await get('/fresh-panel/tools')).text, /0 rules/, 'so are the redirects');
  log('reinstalled under a new admin URL: one sample page, empty library, no redirects');
});

/* ----------------------------------------------------- database password */

const lock = createHarness();
const DB_PASSWORD = 'a-long-database-password';

test('DB_PASSWORD locks the database to that password', { skip: !onNode && 'D1 has no password to present' }, async () => {
  await lock.start({ env: { DB_PASSWORD } });
  const lockAdmin = (await lock.install()).admin;
  assert.equal((await health(lock)).installed, true);

  const page = await lock.get(`${lockAdmin}/tools/health`);
  assert.match(page.text, /<dt>Database password<\/dt><dd>Set\./, 'Site Health reports the lock');

  const dbFile = join(lock.dataDir, 'cms.sqlite');
  assert.equal(statSync(dbFile).mode & 0o077, 0, 'the database file is owner-only');
  assert.equal(statSync(lock.dataDir).mode & 0o077, 0, 'and so is the folder holding it');
  assert.equal(statSync(join(lock.dataDir, 'media')).mode & 0o077, 0, 'and the media folder');

  await lock.stop();
  await assert.rejects(() => lock.start({ env: { DB_PASSWORD: null } }), /DB_PASSWORD is missing/, 'no password, no server');
  await assert.rejects(() => lock.start({ env: { DB_PASSWORD: 'the-wrong-one' } }), /DB_PASSWORD is wrong/, 'a wrong password is refused');

  await lock.start({ env: { DB_PASSWORD } });
  assert.equal((await health(lock)).installed, true, 'the site is untouched by the refused starts');
  assert.equal((await lock.anon('/')).status, 200);
  log('locked on first start, refused without the password, opened again with it');
});

test('DB_PASSWORD_UNLOCK=1 removes a lost password and leaves the data alone', { skip: !onNode }, async () => {
  await lock.stop();
  await lock.start({ env: { DB_PASSWORD: null, DB_PASSWORD_UNLOCK: '1' } });
  assert.equal((await health(lock)).installed, true);

  await lock.stop();
  await lock.start({ env: { DB_PASSWORD: null, DB_PASSWORD_UNLOCK: null } });
  assert.equal((await health(lock)).installed, true, 'no password is needed any more');
  assert.equal((await lock.anon('/')).status, 200);
  assert.match((await lock.get(`${lock.admin}/tools/health`)).text, /<dt>Database password<\/dt><dd>Not set\./);
  log('unlocked once, on purpose, and the site carried on');
});

test('a database password shorter than 8 characters is refused', { skip: !onNode }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'edge-cms-lock-'));
  await lock.stop();
  try {
    await assert.rejects(() => lock.start({ dataDir: dir, env: { DB_PASSWORD: 'abc' } }), /shorter than 8 characters/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  log('a weak password never locks a database');
});
