// End-to-end test: boots a real server on an empty data folder, walks through
// the installer and the whole admin workflow over HTTP, and checks the public
// site after every step. The same steps run against both runtimes:
//
//   npm test                    Node.js server (SQLite + disk)
//   npm run test:cloudflare     Cloudflare runtime (wrangler dev: D1 + KV + R2)
//
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { ADMIN, TARGET, createHarness } from './helpers.mjs';
import { JSDOM, VirtualConsole } from 'jsdom';

let admin = '/admin-panel';
let base = '';
const setAdmin = (slug) => { admin = slug; harness.setAdmin(slug); };
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const log = (msg) => console.log(`    · ${msg}`);
const landingVirtualConsole = new VirtualConsole();
landingVirtualConsole.on('jsdomError', (error) => {
  if (!String(error.message).includes('Could not parse CSS stylesheet')) console.error(error);
});

/* ------------------------------------------------------------------ server */
// Boot, cookie jar and the HTTP helpers all live in tests/helpers.mjs so a new
// test can start from a working panel in three lines.
const harness = createHarness();

before(async () => {
  const health = await harness.start();
  base = harness.base;
  console.log(`\n  target: ${TARGET}  url: ${base}  data: ${harness.dataDir}`);
  console.log(`  health: ${JSON.stringify(health)}\n`);
});

after(async () => {
  await harness.stop();
  harness.cleanup();
});

const request = (...args) => harness.request(...args);
const jar = harness.jar;
const get = (...args) => harness.get(...args);
const anon = (...args) => harness.anon(...args);
const form = (...args) => harness.form(...args);
const csrf = (...args) => harness.csrf(...args);
const adminPost = (...args) => harness.adminPost(...args);
const anonPost = (...args) => harness.anonPost(...args);

const idFrom = (location) => Number(location.match(/\/(\d+)(\?|$)/)[1]);
const fieldValue = (html, name) => {
  const m = html.match(new RegExp(`name="${name}" value="([^"]*)"`));
  assert.ok(m, `${name} field is present`);
  return m[1];
};
/** Builds a small zip in memory (first file stored, the rest deflated). */
function makeZip(files) {
  const locals = [], central = [];
  let offset = 0;
  Object.entries(files).forEach(([name, text], i) => {
    const raw = Buffer.from(text), nameBuf = Buffer.from(name);
    const method = i === 0 ? 0 : 8;
    const data = method ? deflateRawSync(raw) : raw;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(method, 8);
    head.writeUInt32LE(crc32(raw), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, data); central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  });
  const cdBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}
async function uploadTheme(name, bytes) {
  const body = new FormData();
  body.set('_csrf', await csrf());
  body.append('theme', new File([bytes], name));
  const res = await request(`${admin}/themes/upload`, { method: 'POST', body });
  // A theme is named by a person, and the confirmation quotes that name, so the
  // Location: is a UTF-8 byte string. Decode it to what the browser would show.
  let readable = res.location || '';
  try {
    readable = decodeURIComponent(escape(readable));
  } catch {
    /* leave it as it came */
  }
  return { ...res, location: readable };
}
const themeId = async (name) => {
  const row = (await get(`${admin}/themes`)).text.match(new RegExp(`data-theme-id="(\\d+)"[\\s\\S]{0,400}?<a href="[^"]*/themes/[^"]*">${name}</a>`));
  assert.ok(row, `theme "${name}" is listed`);
  return Number(row[1]);
};

const nav = (htmlText) => [...htmlText.match(/<nav class="site-nav"[^]*?<\/nav>/)[0].matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => `${m[2]}=${m[1]}`);

const currentPostUrl = () => {
  const y = new Date().getUTCFullYear(), m = String(new Date().getUTCMonth() + 1).padStart(2, '0');
  return `/${y}/${m}/launch-day-more`;
};
const SITE_SETTINGS = {
  site_title: 'Renamed Site', tagline: 'Now with a tagline', timezone: 'Asia/Karachi', primary_domain: 'example.com',
  domains: 'www.example.com', admin_slug: 'control-room', permalink_style: 'dated', posts_per_page: 5,
  home_page_id: 1, favicon: '',
};

const INSTALL = {
  username: ADMIN.username, email: ADMIN.email, password: ADMIN.password, password2: ADMIN.password,
  title: 'E2E Test Site', domain: 'example.com', slug: 'admin-panel',
};
const state = {};

test('1. fresh start: storage is healthy and every URL leads to the installer', async () => {
  const health = JSON.parse((await anon('/api/health')).text);
  assert.equal(health.ok, true);
  assert.equal(health.installed, false);
  assert.deepEqual(health.checks, { database: true, keyvalue: true, media: true });
  assert.equal(health.runtime, TARGET === 'node' ? 'node' : 'cloudflare-workers');
  for (const path of ['/', '/blog', '/admin-panel', '/some/deep/path', '/api/posts']) {
    const res = await anon(path);
    assert.equal(res.status, 302, path);
    assert.equal(res.location, '/install', path);
  }
  const wizard = await anon('/install');
  assert.equal(wizard.status, 200);
  assert.equal((wizard.text.match(/data-step/g) || []).length >= 3, true, 'wizard has three steps');
  log(`runtime "${health.runtime}", database/kv/media reachable, installer shown`);
});

test('2. installer rejects invalid input and installs nothing', async () => {
  const bad = await request('/install', { method: 'POST', cookies: false, body: form({ ...INSTALL, username: 'x', email: 'nope', password: 'short', password2: 'other', slug: 'api' }) });
  assert.equal(bad.status, 400);
  for (const msg of ['Username', 'valid email', 'at least 8', 'do not match', 'Admin slug']) assert.match(bad.text, new RegExp(msg));
  const cross = await request('/install', { method: 'POST', cookies: false, body: form(INSTALL), headers: { origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  assert.equal((await anon('/')).location, '/install');
  log('5 validation errors reported, cross-site submission blocked');
});

test('3. installer sets the site up and then locks itself', async () => {
  const res = await request('/install', { method: 'POST', cookies: false, body: form(INSTALL) });
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/admin-panel"/);
  assert.equal((await anon('/install')).status, 404);
  const again = await request('/install', { method: 'POST', cookies: false, body: form({ ...INSTALL, username: 'intruder' }) });
  assert.equal(again.status, 404);
  assert.equal(JSON.parse((await anon('/api/health')).text).installed, true);
  log('installed; /install now returns 404 for GET and POST');
});

test('4. public site shows the themed sample home page and caches it', async () => {
  const first = await anon('/');
  assert.equal(first.status, 200);
  assert.match(first.text, /<title>E2E Test Site<\/title>/);
  assert.match(first.text, /Welcome to E2E Test Site/);
  assert.match(first.text, /<a href="\/blog"/, 'seeded menu is rendered');
  assert.equal(first.headers.get('x-cache'), 'MISS');
  assert.equal((await anon('/')).headers.get('x-cache'), 'HIT');
  assert.equal((await anon('/blog')).status, 200);
  assert.equal((await anon('/missing-page')).status, 404);
  assert.equal((await anon('/home')).location, '/', 'home page slug redirects to /');
  log('home 200 (MISS then HIT), blog 200, unknown page 404');
});

test('5. admin panel: protected, CSRF enforced, login works', async () => {
  for (const path of ['', '/posts', '/media', '/settings']) {
    const res = await anon(admin + path);
    assert.equal(res.status, 302, path);
    assert.equal(res.location, `${admin}/login`);
  }
  const token = await csrf();
  const noToken = await request(`${admin}/login`, { method: 'POST', body: form({ login: ADMIN.username, password: ADMIN.password }) });
  assert.equal(noToken.status, 403);
  const cross = await request(`${admin}/login`, { method: 'POST', body: form({ _csrf: token, login: ADMIN.username, password: ADMIN.password }), headers: { origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  const wrong = await adminPost('/login', { login: ADMIN.username, password: 'wrong password' });
  assert.match(wrong.location, /err=Wrong/);
  const ok = await adminPost('/login', { login: ADMIN.email, password: ADMIN.password });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, admin);
  const dash = await get(admin);
  assert.equal(dash.status, 200);
  assert.match(dash.text, /<b>1<\/b><span>Pages/);
  assert.match(dash.text, /<b>0<\/b><span>Posts/);
  assert.match(dash.text, /<b>0<\/b><span>Media/);
  log('anonymous access redirected, missing/foreign CSRF rejected, logged in by email, dashboard 1/0/0');
});

test('6. pages: create, publish, edit, cache is invalidated', async () => {
  const created = await adminPost('/pages/save', { title: 'About Us', slug: '', body: '<p>We build things.</p>', status: 'published', seo_title: 'About — custom', seo_description: 'Who we are' });
  assert.equal(created.status, 303);
  state.pageId = idFrom(created.location);
  let pub = await anon('/about-us');
  assert.equal(pub.status, 200);
  assert.match(pub.text, /We build things\./);
  assert.match(pub.text, /<title>About — custom<\/title>/);
  assert.match(pub.text, /<meta name="description" content="Who we are">/);
  await anon('/about-us'); // now cached
  await adminPost('/pages/save', { id: state.pageId, title: 'About Us', slug: 'about-us', body: '<p>We build better things.</p>', status: 'published' });
  pub = await anon('/about-us');
  assert.match(pub.text, /We build better things\./, 'edit is visible immediately');
  const pagesWithoutDrafts = await get(`${admin}/pages`);
  assert.match(pagesWithoutDrafts.text, /Draft <span class="tab-count">0<\/span>/, 'all status tabs remain available when a status has no pages');
  const reserved = await adminPost('/pages/save', { title: 'Blog', slug: 'blog', body: '', status: 'draft' });
  const editor = await get(reserved.location.split('?')[0]);
  assert.match(editor.text, /<title>Edit page/, 'edit URL opens the editor, not the list');
  assert.match(editor.text, /name="slug" value="blog-page"/, 'reserved slug is renamed');
  assert.match(editor.text, /data-editor-mode="text"/);
  assert.match(editor.text, /data-editor-mode="html"/);
  assert.match(editor.text, /id="visual-editor"[^]*contenteditable="true"|contenteditable="true"[^]*id="visual-editor"/);
  assert.match(editor.text, /id="add-html-block"/);
  assert.match(editor.text, /id="add-youtube"/);
  assert.match(editor.text, /id="youtube-dialog"/);

  // Every post/page picks its editor: a classic/modern chooser on Add New and
  // on Edit (until a preference is remembered), plus a switch inside the page.
  const newPost = await get(`${admin}/posts/new`);
  assert.match(newPost.text, /id="editor-mode-dialog"/, 'Add New offers the editor chooser');
  assert.match(newPost.text, /data-skin-choice="modern"/);
  assert.match(newPost.text, /data-skin-choice="classic"/);
  assert.match(newPost.text, /data-editor-skin-set="classic"/, 'the editor can switch skin in place');
  assert.match(newPost.text, /data-editor-skin-set="modern"/);
  assert.match(newPost.text, /data-is-new="1"/);
  assert.match(editor.text, /data-is-new="0"/, 'edit has its own state');
  assert.match(editor.text, /id="editor-mode-switch"/, 'Text/HTML switch is present');
  assert.match(editor.text, /id="editor-status" role="status"/, 'the switch reports its state');
  // Classic must never hide its own switch: the bar holding Classic/Modern
  // stays visible in both skins, and the rendered skin class is the chosen one.
  assert.doesNotMatch(editor.text, /is-classic \.ams-editor-bar\{display:none\}/, 'classic does not hide the Classic/Modern switch');
  assert.match(editor.text, /class="ams-editor is-modern" id="content-editor"/, 'editor renders its initial skin class');
  assert.match(editor.text, /applySkin\(skin\)/, 'boot keeps the remembered skin instead of resetting it');
  // Images get size/align controls and drag anchors, inserted at 50% not full width.
  assert.match(editor.text, /id="image-tools"/, 'selected-image toolbar is present');
  assert.match(editor.text, /data-img-size="50"/, 'image size presets are present');
  assert.match(editor.text, /data-img-align="left"/, 'image alignment controls are present');
  assert.match(editor.text, /id="img-overlay"/, 'image resize anchors overlay is present');
  assert.match(editor.text, /data-handle="se"/, 'image corner drag anchor is present');
  assert.match(editor.text, /clampWidth\(o\.width\)|width:'\+width\+'%/, 'a picked image is placed at the width the dialog says');
  assert.match(editor.text, /align:'center'/, 'inserted images are centred');
  assert.match(editor.text, /id="image-tools"[\s\S]*data-img-caption/, 'the image bar edits the caption in place');
  assert.match(editor.text, /id="image-tools"[\s\S]*data-img-alt/, 'alt text is editable from the image bar');
  assert.match(editor.text, /id="editor-stats"/, 'the word count is shown while writing');
  assert.match(editor.text, /id="slug-preview"/, 'the slug is previewed under its field');
  assert.match(editor.text, /id="link-dialog"/, 'links are made in a dialog, not a prompt');
  assert.match(editor.text, /id="add-page-break"/, 'a print page break can be inserted');
  assert.match(editor.text, /function insertImageAtCaret[\s\S]*?toText\(\)/, 'inserting an image switches HTML mode to Text so its anchors show');
  assert.match(editor.text, /visual\.addEventListener\('input',positionOverlay\)/, 'anchors follow the image while typing');
  assert.match(editor.text, /window\.addEventListener\('pointermove',move\)/, 'anchor drags are tracked on the window, not just the handle');

  const pageList = await get(`${admin}/pages`);
  for (const label of ['Add Page', 'All', 'Published', 'Draft', 'Search Pages', 'Bulk actions', 'Comments', 'Date']) {
    assert.ok(pageList.text.includes(label), `pages list includes ${label}`);
  }
  assert.match(pageList.text, /class="table list-table"/);
  assert.match((await get(`${admin}/pages?q=About`)).text, /About Us/);
  assert.match((await get(`${admin}/pages?status=draft`)).text, /Blog/);
  const currentMonth = new Date().toISOString().slice(0, 7);
  assert.match((await get(`${admin}/pages?month=${currentMonth}`)).text, /About Us/);
  const reservedId = idFrom(reserved.location);
  assert.equal((await adminPost('/pages/bulk', { action: 'publish', ids: [reservedId] })).status, 303);
  assert.equal((await anon('/blog-page')).status, 200);
  assert.equal((await adminPost('/pages/bulk', { action: 'draft', ids: [reservedId] })).status, 303);
  assert.equal((await anon('/blog-page')).status, 404);
  assert.equal((await adminPost('/pages/bulk', { action: 'delete', ids: [reservedId] })).status, 303);
  assert.equal((await get(`${admin}/pages/${reservedId}`)).status, 404);
  assert.equal((await get(`${admin}/pages/999`)).status, 404);
  assert.equal((await get(`${admin}/pagesx`)).status, 404);
  log(`page #${state.pageId} live at /about-us, SEO tags rendered, edit visible without waiting`);
});

test('7. media: upload to storage, serve identical bytes, refuse unsafe types', async () => {
  const emptyMedia = await get(`${admin}/media`);
  for (const label of ['Media Library', 'Add Media File', 'All media items', 'All dates', 'Bulk select', 'Search media', 'No media items found.']) {
    assert.ok(emptyMedia.text.includes(label), `media library includes ${label}`);
  }
  const body = new FormData();
  body.set('_csrf', await csrf());
  body.append('files', new File([PNG], 'Team Photo.PNG', { type: 'image/png' }));
  body.append('files', new File(['<script>alert(1)</script>'], 'evil.html', { type: 'text/html' }));
  const up = await request(`${admin}/media/upload`, { method: 'POST', body });
  assert.match(up.location, /1 uploaded\. Skipped.*evil\.html/);
  const lib = await get(`${admin}/media`);
  state.mediaUrl = lib.text.match(/data-copy="([^"]+)"/)[1];
  state.mediaId = Number(lib.text.match(/media\/(\d+)\/delete/)[1]);
  assert.match(state.mediaUrl, /^\/media\/\d{4}\/\d{2}\/[\w-]+-team-photo\.png$/);
  const file = await fetch(base + state.mediaUrl);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
  assert.match(lib.text, /List view/);
  assert.match(lib.text, /Grid view/);
  assert.match((await get(`${admin}/media?q=team-photo&type=images`)).text, /team-photo\.png/);
  assert.match((await get(`${admin}/media?view=list`)).text, /class="media-list-table"/);
  assert.match((await get(`${admin}/media?type=audio`)).text, /No media items found\./);
  const month = new Date().toISOString().slice(0, 7);
  assert.match((await get(`${admin}/media?month=${month}`)).text, /team-photo\.png/);

  const extra = new FormData();
  extra.set('_csrf', await csrf());
  extra.append('files', new File(['temporary test file'], 'Delete Me.txt', { type: 'text/plain' }));
  await request(`${admin}/media/upload`, { method: 'POST', body: extra });
  const bulkList = await get(`${admin}/media?bulk=1`);
  const bulkFigure = bulkList.text.match(/<figure class="media-item">[^]*?delete-me\.txt[^]*?<\/figure>/)?.[0];
  assert.ok(bulkFigure, 'bulk mode shows the selected file and its checkbox');
  const bulkId = Number(bulkFigure.match(/name="ids" value="(\d+)" form="media-bulk-form"/)[1]);
  const bulkUrl = bulkFigure.match(/data-copy="([^"]+)"/)[1];
  assert.match((await adminPost('/media/bulk', { ids: [bulkId] })).location, /deleted/);
  assert.equal((await anon(bulkUrl)).status, 404);
  assert.equal((await anon('/media/..%2F..%2Fcms.sqlite')).status, 404);
  log(`uploaded ${state.mediaUrl}, list/grid, search and filters work, bulk delete removes selected file, path traversal blocked`);
});

test('8. posts: categories, tags, featured image, archives and JSON API', async () => {
  const created = await adminPost('/posts/save', {
    title: 'Launch Day & More', body: '<p>Hello <strong>world</strong></p>', status: 'published',
    new_cats: 'News, Company', tags: 'launch, updates', featured_media_id: state.mediaId, excerpt: 'Short summary',
  });
  state.postId = idFrom(created.location);
  const post = await anon('/blog/launch-day-more');
  assert.equal(post.status, 200);
  assert.match(post.text, /Launch Day &amp; More/);
  assert.match(post.text, /href="\/category\/news"/);
  assert.match(post.text, /href="\/tag\/launch"/);
  assert.ok(post.text.includes(`src="${state.mediaUrl}"`), 'featured image is rendered');
  for (const path of ['/blog', '/category/news', '/category/company', '/tag/updates', '/']) {
    assert.match((await anon(path)).text, /Launch Day &amp; More/, path);
  }
  assert.equal((await anon('/category/nothing')).status, 404);
  const api = JSON.parse((await anon('/api/posts')).text);
  assert.equal(api.total, 1);
  assert.equal(api.posts[0].url, '/blog/launch-day-more');
  assert.equal(api.posts[0].excerpt, 'Short summary');
  assert.deepEqual(api.posts[0].tags.map((t) => t.slug).sort(), ['launch', 'updates']);
  assert.equal(JSON.parse((await anon('/api/posts/launch-day-more')).text).title, 'Launch Day & More');
  const editor = await get(`${admin}/posts/${state.postId}`);
  assert.equal((editor.text.match(/type="checkbox" name="cat" value="\d+" checked/g) || []).length, 2, 'categories stay ticked');

  const video = await adminPost('/posts/save', {
    title: 'Video Post', status: 'published',
    body: '<div class="html-block"><p>First custom block</p></div><div class="html-block"><p>Second custom block</p></div><figure class="video-block youtube-video"><div class="video-responsive"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Demo video" loading="lazy" allowfullscreen></iframe></div></figure>',
  });
  const videoId = idFrom(video.location);
  const videoPage = await anon('/blog/video-post');
  assert.equal(videoPage.status, 200);
  assert.equal((videoPage.text.match(/class="html-block"/g) || []).length, 2, 'multiple HTML blocks are rendered');
  assert.match(videoPage.text, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ" title="Demo video"/);
  assert.match(videoPage.text, /aspect-ratio:16\/9/, 'video embed is responsive');
  await adminPost(`/posts/${videoId}/delete`, {});
  log(`post #${state.postId} on /blog, 2 category pages, tag page, home page and API; HTML blocks and YouTube embed rendered`);
});

test('8a. posts list searches, filters and applies bulk actions', async () => {
  const all = await get(`${admin}/posts`);
  for (const label of ['Add Post', 'All', 'Published', 'Categories', 'Tags', 'Comments', 'Date', 'Bulk actions']) {
    assert.ok(all.text.includes(label), `posts list includes ${label}`);
  }
  assert.match(all.text, /class="table list-table"/);
  assert.match(all.text, /Launch Day &amp; More/);
  assert.match(all.text, /name="ids"/);
  assert.match(all.text, /name="action" form="posts-bulk-form"/);
  assert.match(all.text, /class="bulk-bar"/, 'bulk actions live in one bar');
  assert.match(all.text, /data-label="Date"/, 'rows carry labels for the card layout');

  const searched = await get(`${admin}/posts?q=Launch+Day`);
  assert.match(searched.text, /Launch Day &amp; More/);
  const empty = await get(`${admin}/posts?q=not-a-real-title`);
  assert.doesNotMatch(empty.text, /Launch Day &amp; More/);
  assert.match(empty.text, /No posts match/);
  const editor = await get(`${admin}/posts/${state.postId}`);
  const categoryId = editor.text.match(/name="cat" value="(\d+)" checked/)[1];
  const byCategory = await get(`${admin}/posts?category=${categoryId}`);
  assert.match(byCategory.text, /Launch Day &amp; More/);
  assert.doesNotMatch(byCategory.text, /Video Post/);
  const currentMonth = new Date().toISOString().slice(0, 7);
  assert.match((await get(`${admin}/posts?month=${currentMonth}`)).text, /Launch Day &amp; More/);
  assert.match((await get(`${admin}/posts?sort=title&dir=asc`)).text, /aria-sort="ascending"/);

  const draft = await adminPost('/posts/save', { title: 'Bulk Action Candidate', status: 'draft' });
  const id = idFrom(draft.location);
  assert.match((await get(`${admin}/posts?status=draft`)).text, /Bulk Action Candidate/);
  const published = await adminPost('/posts/bulk', { action: 'publish', ids: [id] });
  assert.equal(published.status, 303);
  assert.match(published.location, /posts\?ok=/);
  assert.equal((await anon('/blog/bulk-action-candidate')).status, 200);
  const movedToDraft = await adminPost('/posts/bulk', { action: 'draft', ids: [id] });
  assert.equal(movedToDraft.status, 303);
  assert.equal((await anon('/blog/bulk-action-candidate')).status, 404);
  const deleted = await adminPost('/posts/bulk', { action: 'delete', ids: [id] });
  assert.equal(deleted.status, 303);
  assert.equal((await get(`${admin}/posts/${id}`)).status, 404);
  log('posts table renders, search and category filters narrow results, bulk publish/delete update content');
});

test('9. drafts and scheduled posts stay hidden; preview needs a login', async () => {
  const draft = await adminPost('/posts/save', { title: 'Secret Draft', body: '<p>wip</p>', status: 'draft' });
  state.draftId = idFrom(draft.location);
  const noDate = await adminPost('/posts/save', { title: 'No Date', body: '', status: 'scheduled', publish_at: '' });
  assert.match(noDate.location, /err=Pick a publish date/);
  const later = await adminPost('/posts/save', { title: 'Next Century', body: '<p>later</p>', status: 'scheduled', publish_at: '2099-06-01T09:30' });
  assert.match(later.location, /scheduled/);
  for (const path of ['/blog/secret-draft', '/blog/next-century', '/blog/secret-draft?preview=1']) assert.equal((await anon(path)).status, 404, path);
  assert.doesNotMatch((await anon('/blog')).text, /Secret Draft|Next Century/);
  assert.equal(JSON.parse((await anon('/api/posts')).text).total, 1);
  const preview = await get('/blog/secret-draft?preview=1');
  assert.equal(preview.status, 200);
  assert.match(preview.text, /noindex/);
  const past = await adminPost('/posts/save', { title: 'Backdated', body: '<p>old</p>', status: 'scheduled', publish_at: '2020-01-01T00:00' });
  assert.match(past.location, /published/, 'a schedule date in the past publishes immediately');
  log('draft + future post invisible to visitors and API, preview works only when signed in');
});

test('10. settings: timezone, permalinks and a moved admin URL take effect at once', async () => {
  const badZone = await adminPost('/settings', { site_title: 'X', timezone: 'Mars/Phobos', primary_domain: 'example.com', admin_slug: 'admin-panel', permalink_style: 'blog', posts_per_page: 10 });
  assert.match(badZone.location, /err=Unknown timezone/);
  const saved = await adminPost('/settings', {
    site_title: 'Renamed Site', tagline: 'Now with a tagline', timezone: 'Asia/Karachi', primary_domain: 'example.com',
    domains: 'www.example.com', admin_slug: 'control-room', permalink_style: 'dated', posts_per_page: 5, home_page_id: 1, favicon: '',
  });
  assert.equal(saved.location, '/control-room/settings?ok=Settings saved.');
  assert.equal((await get('/admin-panel')).status, 404, 'old admin URL is gone');
  setAdmin('/control-room');
  assert.equal((await get(admin)).status, 200);
  const home = await anon('/');
  assert.match(home.text, /<title>Renamed Site – Now with a tagline<\/title>/);
  assert.equal((await anon('/blog/launch-day-more')).status, 404);
  const y = new Date().getUTCFullYear(), m = String(new Date().getUTCMonth() + 1).padStart(2, '0');
  assert.equal((await anon(`/${y}/${m}/launch-day-more`)).status, 200);
  assert.equal((await anon('/1999/01/launch-day-more')).location, `/${y}/${m}/launch-day-more`);
  const editor = await get(`${admin}/posts/${state.postId}`);
  assert.match(editor.text, /Publish date \(Asia\/Karachi\)/);

  // The site-wide default decides which editor the chooser starts on.
  await adminPost('/settings', { ...SITE_SETTINGS, default_editor: 'classic' });
  assert.match((await get(`${admin}/posts/new`)).text, /data-initial-skin="classic"/, 'settings pick the default editor');
  assert.match((await get(`${admin}/pages/new`)).text, /data-initial-skin="classic"/, 'pages use the same default');
  await adminPost('/settings', { ...SITE_SETTINGS, default_editor: 'modern' });
  assert.match((await get(`${admin}/posts/new`)).text, /data-initial-skin="modern"/);
  await adminPost('/settings', { ...SITE_SETTINGS, default_editor: 'ask' });
  assert.match((await get(`${admin}/posts/new`)).text, /data-initial-skin="modern"/, 'ask falls back to the modern editor');
  assert.match((await get(`${admin}/settings`)).text, /value="ask" selected/, 'the choice is stored');
  log('title/tagline live, posts moved to /YYYY/MM/slug with redirect, admin moved to /control-room, default editor saved');
});

test('10b. landing screen: choose a page, upload a looping soundtrack and enter the home page', async () => {
  const selected = await adminPost(`/pages/${state.pageId}/landing`, {});
  assert.equal(selected.status, 303);
  assert.match(selected.location, /Landing screen set/);
  const pages = await get(`${admin}/pages`);
  assert.match(pages.text, /class="badge published">landing screen/);
  assert.match(pages.text, new RegExp(`action="${admin}\\/pages\\/${state.pageId}\\/landing"`));

  const upload = new FormData();
  upload.set('_csrf', await csrf());
  for (const [key, value] of Object.entries({ ...SITE_SETTINGS, landing_page_id: state.pageId })) upload.set(key, String(value));
  upload.append('landing_audio_files', new File(['sample audio bytes'], 'Welcome Track.MP3', { type: 'audio/mpeg' }));
  upload.append('landing_audio_files', new File(['second track bytes'], 'Ambient Loop.ogg', { type: 'audio/ogg' }));
  const saved = await request(`${admin}/settings`, { method: 'POST', body: upload });
  assert.equal(saved.status, 303);
  assert.match(saved.location, /Settings saved/);

  const panelSettings = await get(`${admin}/settings`);
  assert.match(panelSettings.text, /id="landing_page_id"/);
  assert.match(panelSettings.text, /name="landing_audio_ids"[^>]*checked/);
  assert.match(panelSettings.text, /welcome-track\.mp3/);
  assert.match(panelSettings.text, /name="landing_audio_files"[^]*multiple/);

  const home = await anon('/');
  assert.match(home.text, /id="ams-landing-screen"[^]*role="dialog"/);
  assert.ok(home.text.includes('<h1 id="ams-landing-title">About Us</h1>'));
  assert.ok(home.text.includes('We build better things.'));
  assert.match(home.text, /data-landing-play/);
  assert.match(home.text, /data-landing-mute/);
  assert.match(home.text, /data-landing-enter/);
  assert.match(home.text, /data-ams-landing/);
  assert.match(home.text, /sessionStorage\.setItem\('ams-landing-entered','1'\)/);
  assert.match(home.text, /audio\.pause\(\)/);
  assert.match(home.text, /audio\.addEventListener\('ended'/, 'the playlist advances and loops');
  assert.match(home.text, /place-items:center/, 'the responsive landing layout centers its play button');
  const audioUrl = home.text.match(/\/media\/\d{4}\/\d{2}\/[^"&]+-welcome-track\.mp3/);
  assert.ok(audioUrl, 'the uploaded track is wired into the landing playlist');
  const audio = await anon(audioUrl[0]);
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
  const landingDom = new JSDOM(home.text, { url: base + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: landingVirtualConsole });
  const landingWindow = landingDom.window;
  const landingScreen = landingWindow.document.getElementById('ams-landing-screen');
  assert.equal(landingWindow.document.documentElement.getAttribute('data-ams-landing'), 'show', 'a new tab session opens the landing screen');
  const player = landingWindow.document.querySelector('[data-landing-audio]');
  Object.defineProperty(player, 'paused', { configurable: true, writable: true, value: true });
  player.load = () => {};
  let playCount = 0;
  player.play = () => { playCount++; player.paused = false; player.dispatchEvent(new landingWindow.Event('play')); return Promise.resolve(); };
  player.pause = () => { player.paused = true; player.dispatchEvent(new landingWindow.Event('pause')); };
  landingWindow.document.querySelector('[data-landing-play]').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(playCount, 1, 'Play starts the soundtrack on a visitor gesture');
  assert.equal(landingScreen.querySelector('.ams-landing-card').classList.contains('is-playing'), true, 'the equalizer animates while audio plays');
  const firstTrack = player.src;
  player.dispatchEvent(new landingWindow.Event('ended'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(player.src, firstTrack, 'the playlist advances to the next uploaded track');
  landingWindow.document.querySelector('[data-landing-mute]').click();
  assert.equal(landingWindow.document.querySelector('[data-landing-mute]').getAttribute('aria-pressed'), 'true');
  landingWindow.document.querySelector('[data-landing-enter]').click();
  assert.equal(player.paused, true, 'Enter stops playback');
  assert.equal(landingWindow.document.getElementById('ams-landing-screen'), null, 'Enter removes the landing screen and reveals home');
  assert.equal(landingWindow.document.documentElement.hasAttribute('data-ams-landing'), false);
  assert.equal(landingWindow.sessionStorage.getItem('ams-landing-entered'), '1', 'Enter dismisses the screen for this tab session');
  landingDom.window.close();
  const returningDom = new JSDOM(home.text, {
    url: base + '/', runScripts: 'dangerously',
    virtualConsole: landingVirtualConsole,
    beforeParse(window) { window.sessionStorage.setItem('ams-landing-entered', '1'); },
  });
  assert.equal(returningDom.window.document.documentElement.hasAttribute('data-ams-landing'), false, 'the landing screen stays hidden in the same session');
  returningDom.window.close();
  await adminPost(`/pages/${state.pageId}/landing`, {}); // leave later theme tests on their normal home page
  log('Pages assignment, in-Settings upload/playlist, first-visit splash, responsive Play/mute/Enter, session reset and audio storage work');
});

test('11. profile: password change keeps this session and old password stops working', async () => {
  const wrong = await adminPost('/profile', { email: ADMIN.email, new_password: 'another long password', current_password: 'not it' });
  assert.match(wrong.location, /err=Current password/);
  const stale = new Map(jar);
  const ok = await adminPost('/profile', { email: ADMIN.email, new_password: 'another long password', current_password: ADMIN.password });
  assert.match(ok.location, /ok=Profile saved/);
  assert.equal((await get(admin)).status, 200, 'current session continues');
  const old = await fetch(base + admin, { redirect: 'manual', headers: { cookie: [...stale].map(([k, v]) => `${k}=${v}`).join('; ') } });
  assert.equal(old.status, 302, 'sessions signed before the change are rejected');
  ADMIN.password = 'another long password';
  log('password changed, other sessions invalidated');
});

test('12. data survives a restart', async () => {
  await harness.stop();
  await harness.start();
  const health = JSON.parse((await anon('/api/health')).text);
  assert.equal(health.installed, true);
  assert.match((await anon('/about-us')).text, /We build better things\./);
  assert.equal((await fetch(base + state.mediaUrl)).status, 200);
  assert.equal((await get(admin)).status, 200, 'still signed in');
  log('server restarted: still installed, content, media and session intact');
});

test('12a. menus: pages join the main menu with one tick; reorder, custom links, footer', async () => {
  assert.deepEqual(nav((await anon('/')).text), ['Home=/', 'Blog=/blog'], 'seeded menu');
  const made = await adminPost('/pages/save', { title: 'Services', body: '<p>What we do</p>', status: 'published', in_menu: 1 });
  const servicesId = idFrom(made.location);
  assert.deepEqual(nav((await anon('/')).text), ['Home=/', 'Blog=/blog', 'Services=/services'], 'ticked page appears in the header');
  assert.match((await get(`${admin}/pages/${servicesId}`)).text, /name="in_menu" value="1" checked/);
  assert.match((await get(`${admin}/pages/new`)).text, /name="in_menu" value="1" checked/, 'new pages start ticked');

  await adminPost('/pages/save', { id: servicesId, title: 'Services', slug: 'what-we-do', body: '<p>x</p>', status: 'published', in_menu: 1 });
  assert.deepEqual(nav((await anon('/')).text), ['Home=/', 'Blog=/blog', 'Services=/what-we-do'], 'menu link follows a slug change');

  const draft = await adminPost('/pages/save', { title: 'Hidden Draft', body: '', status: 'draft', in_menu: 1 });
  assert.equal(nav((await anon('/')).text).length, 3, 'drafts are never linked');

  // reorder + rename + custom link through the menu editor (row order = menu order)
  const editor = await get(`${admin}/menus`);
  assert.equal(editor.status, 200);
  const menuId = Number(editor.text.match(/menus\/(\d+)\/save/)[1]);
  const saved = await adminPost(`/menus/${menuId}/save`, {
    name: 'Main', location: 'primary',
    label: ['Our Services', 'Home', 'Docs', 'Bad', ''], url: ['/what-we-do', '/', 'https://example.org/docs', 'javascript:alert(1)', ''],
  });
  assert.match(saved.location, /1 link was skipped/);
  assert.deepEqual(nav((await anon('/')).text), ['Our Services=/what-we-do', 'Home=/', 'Docs=https://example.org/docs']);

  // a second menu in the footer
  await adminPost('/menus/new', { name: 'Footer links' });
  const footerId = Math.max(...[...(await get(`${admin}/menus`)).text.matchAll(/menus\/(\d+)\/save/g)].map((m) => Number(m[1])));
  await adminPost(`/menus/${footerId}/save`, { name: 'Footer links', location: 'footer', label: ['Privacy'], url: ['/privacy'] });
  assert.match((await anon('/')).text, /<nav class="footer-nav"[^]*<a href="\/privacy">Privacy<\/a>/);
  await adminPost(`/menus/${footerId}/delete`, {});
  assert.doesNotMatch((await anon('/')).text, /<nav class="footer-nav"/);

  // unticking removes the link; deleting a page removes it too
  await adminPost('/pages/save', { id: servicesId, title: 'Services', slug: 'what-we-do', body: '<p>x</p>', status: 'published' });
  assert.deepEqual(nav((await anon('/')).text), ['Home=/', 'Docs=https://example.org/docs']);
  await adminPost('/pages/save', { id: servicesId, title: 'Services', slug: 'what-we-do', body: '<p>x</p>', status: 'published', in_menu: 1 });
  await adminPost(`/pages/${servicesId}/delete`, {});
  await adminPost(`/pages/${idFrom(draft.location)}/delete`, {});
  assert.deepEqual(nav((await anon('/')).text), ['Home=/', 'Docs=https://example.org/docs']);
  log('tick adds page to header, link follows slug, reorder/rename/custom link saved, unsafe link dropped, footer menu works');
});

test('12b. themes: upload JSON and zip, activate, replace, download, delete', async () => {
  const bad = [
    ['not json', 'nope.json', 'not valid JSON'],
    [JSON.stringify({ name: 'X', templates: { home: 'x' } }), 'x.json', '"base" template'],
    [JSON.stringify({ name: 'X', templates: { base: '<html>no slot</html>' } }), 'x.json', 'must contain'],
    [JSON.stringify({ templates: { base: '{{{content}}}' } }), 'x.json', 'needs a "name"'],
    [makeZip({ 'readme.txt': 'hi' }), 'x.zip', 'does not contain a theme.json'],
  ];
  for (const [bytes, name, message] of bad) assert.ok((await uploadTheme(name, bytes)).location.includes(message), message);

  const json = { name: 'Json Theme', version: '2.1.0', templates: { base: '<!doctype html><html><head>{{{head}}}<style>{{{theme_css}}}</style></head><body data-theme="json">{{#each menu.primary}}<a class="jn" href="{{url}}">{{label}}</a>{{/each}}<main>{{{content}}}</main></body></html>', page: '<h1 class="json-page">{{page.title}}</h1>{{{page.content}}}' }, css: 'body{color:#123456}' };
  // The flash quotes the theme name, so the message itself is what we read
  // (a Location header carries it percent-encoded, and the name has a space).
  const uploaded = await uploadTheme('json-theme.json', JSON.stringify(json));
  assert.match(uploaded.location, /v2\.1\.0 installed/, uploaded.location);
  assert.doesNotMatch((await anon('/')).text, /data-theme="json"/, 'uploading does not activate');
  const jsonId = await themeId('Json Theme');
  await adminPost(`/themes/${jsonId}/activate`, {});
  const home = await anon('/');
  assert.match(home.text, /data-theme="json"/);
  assert.match(home.text, /body\{color:#123456\}/);
  assert.match(home.text, /class="jn" href="\/">Home/);
  assert.match(home.text, /Welcome to E2E Test Site/, 'missing "home" template falls back to the default one');

  // zip with a folder, theme.json naming files, deflated entries
  const zip = makeZip({
    'zip-theme/theme.json': JSON.stringify({ name: 'Zip Theme', version: '0.9', templates: { base: 'layout.html' }, css: 'main.css' }),
    'zip-theme/layout.html': '<!doctype html><html><head>{{{head}}}<style>{{{theme_css}}}</style></head><body data-theme="zip">{{{content}}}</body></html>',
    'zip-theme/404.html': '<p class="zip-404">Lost</p>',
    'zip-theme/main.css': 'body{background:#abcdef}',
  });
  assert.match((await uploadTheme('zip-theme.zip', zip)).location, /v0\.9 installed/);
  const missing = makeZip({ 'theme.json': JSON.stringify({ name: 'Broken', templates: { base: 'gone.html' } }) });
  assert.ok((await uploadTheme('broken.zip', missing)).location.includes('"gone.html" but that file is not in the zip'));
  const zipId = await themeId('Zip Theme');
  await adminPost(`/themes/${zipId}/activate`, {});
  assert.match((await anon('/')).text, /data-theme="zip"[^]*<\/body>/);
  assert.match((await anon('/')).text, /body\{background:#abcdef\}/);
  const lost = await anon('/nowhere');
  assert.equal(lost.status, 404);
  assert.match(lost.text, /class="zip-404"/, 'template picked up by file name');

  // replacing the active theme takes effect at once
  json.name = 'Zip Theme'; json.version = '1.0';
  json.templates.base = json.templates.base.replace('data-theme="json"', 'data-theme="zip-v1"');
  await uploadTheme('again.json', JSON.stringify(json));
  assert.match((await anon('/')).text, /data-theme="zip-v1"/);

  // Phase 3: the stylesheet is served as a cacheable asset, not inlined.
  const sheet = await anon('/theme-assets/zip-theme/style.css');
  assert.equal(sheet.status, 200, 'the theme stylesheet is a served asset');
  assert.match(sheet.headers.get('cache-control'), /immutable/);
  assert.equal(sheet.headers.get('x-content-type-options'), 'nosniff');
  assert.match(sheet.headers.get('content-security-policy'), /default-src 'none'/);

  // Phase 5: the download is a zip that uploads back, plus a JSON view for
  // reading a theme in an editor or a diff.
  const dl = await get(`${admin}/themes/${zipId}/download`);
  assert.match(dl.headers.get('content-disposition'), /zip-theme-1\.0\.zip/);
  assert.equal(dl.headers.get('content-type'), 'application/zip');
  assert.equal(new DataView(dl.bytes.buffer, dl.bytes.byteOffset).getUint32(0, true), 0x04034b50, 'it is a zip');
  const jsonView = await get(`${admin}/themes/${zipId}/download.json`);
  assert.match(jsonView.headers.get('content-disposition'), /zip-theme-theme\.json/);
  assert.equal(JSON.parse(jsonView.text).version, '1.0');

  assert.match((await adminPost(`/themes/${zipId}/delete`, {})).location, /Activate another theme/);
  // Phase 3: an asset-backed theme can still be inspected before it goes.
  const manage = await get(`${admin}/themes/zip-theme`);
  assert.equal(manage.status, 200);
  assert.match(manage.text, /data-asset|\/theme-assets\/zip-theme\/style\.css/, 'the manager lists the stylesheet asset');
  assert.match((await get(`${admin}/themes/zip-theme/validate`)).text, /No problems found|Warning/, 'the validator reports on an installed theme');
  const baseId = await themeId('AMS Base');
  await adminPost(`/themes/${baseId}/activate`, {});
  assert.match((await anon('/')).text, /class="site-header"/);
  assert.match(decodeURIComponent((await adminPost(`/themes/${zipId}/delete`, {})).location), /deleted/);
  assert.match(decodeURIComponent((await adminPost(`/themes/${jsonId}/delete`, {})).location), /deleted/);
  assert.equal(((await get(`${admin}/themes`)).text.match(/class="btn ghost small" href="[^"]+\/download"/g) || []).length, 1, 'only AMS Base is left');
  log('5 bad uploads rejected with reasons; JSON + zip themes installed, activated, replaced live, downloaded, deleted');
});

test('12c. theme store: five bundled themes install and switch with one click', async () => {
  const store = await get(`${admin}/themes`);
  for (const name of ['AMS Base', 'AMS Pro', 'AMS Premium', 'AMS Journal', 'AMS Portfolio']) assert.ok(store.text.includes(`<h3>${name} `), name);
  assert.equal((store.text.match(/store\/[a-z-]+\/install/g) || []).length, 8, 'the four installable themes each offer Install and Install-and-activate');
  // A store card shows a screenshot (or a palette gradient when it ships none),
  // and its tags, so the store looks like a store.
  assert.match(store.text, /class="store-item__shot"/);
  // Nothing is installed yet, so every card falls back to its palette gradient.
  assert.doesNotMatch(store.text, /store-item__shot[^>]*url\(/, 'an uninstalled theme shows a generated card, not a broken image');

  assert.match((await adminPost('/themes/store/ams-pro/install', {})).location, /AMS Pro v1\.0\.0 installed/);
  assert.match((await anon('/')).text, /class="site-header"/, 'installing alone does not switch theme');
  assert.match((await adminPost('/themes/store/ams-pro/install', { activate: 1 })).location, /AMS Pro is now your active theme/);
  const paths = ['/', '/blog', `/${new Date().getUTCFullYear()}/${String(new Date().getUTCMonth() + 1).padStart(2, '0')}/launch-day-more`, '/about-us', '/nowhere'];
  const check = async (marker) => {
    for (const path of paths) {
      const res = await anon(path);
      assert.equal(res.status, path === '/nowhere' ? 404 : 200, path);
      assert.match(res.text, marker, path);
      assert.match(res.text, /<nav class="tabs"[^]*<a href="\/"[^>]*>Home<\/a>/, `${path} has the tab navigation`);
      assert.match(res.text, /<footer class="ftr">[^]*All rights reserved|<footer class="ftr">[^]*Back to top/, `${path} has the footer`);
      assert.doesNotMatch(res.text, /\{\{/, `${path} has no unrendered template tags`);
      assert.doesNotMatch(res.text, /<script|https?:\/\/(?!127\.0\.0\.1|example\.)/, `${path} loads nothing external`);
    }
  };
  await check(/class="brand-mark" aria-hidden="true"><\/span>/);
  assert.match((await anon('/')).text, /<section class="hero">[^]*Renamed Site/);

  assert.match((await adminPost('/themes/store/ams-premium/install', { activate: 1 })).location, /AMS Premium is now your active theme/);
  await check(/class="topbar"/);
  assert.match((await anon('/')).text, /class="eyebrow">Now with a tagline/);
  assert.match((await anon('/')).text, /<a href="\/" aria-current="page">Home<\/a>/, 'current tab is marked');

  const after = await get(`${admin}/themes`);
  assert.equal((after.text.match(/store\/[a-z-]+\/install/g) || []).length, 6, 'installed themes only offer Activate');
  assert.match((await adminPost('/themes/store/nope/install', {})).text, /not in the store/);
  // Installing Journal writes the screenshot the app ships with it, so its card
  // shows the real thing from then on.
  assert.match((await adminPost('/themes/store/ams-journal/install', {})).location, /AMS Journal v1\.0\.0 installed/);
  const withShot = await get(`${admin}/themes`);
  assert.match(withShot.text, /store-item__shot[^>]*url\([^)]*\/theme-assets\/ams-journal\/screenshot\.png/, 'the installed screenshot is served');
  const shotUrl = withShot.text.match(/theme-assets\/ams-journal\/screenshot\.png[^'"]*/)[0];
  const shot = await request('/theme-assets/ams-journal/screenshot.png');
  assert.equal(shot.status, 200);
  assert.ok(shotUrl.length > 0);
  // The bytes really travel: an empty PNG would pass a status check and show a
  // blank card, which is exactly what a build misconfigured for binary assets does.
  assert.equal(shot.bytes[0], 0x89, 'the screenshot is a PNG, not an empty file');
  assert.ok(shot.bytes.length > 1000, 'and it has pixels in it');
  // And the theme itself renders: Journal's own markup, not a fallback.
  assert.match((await adminPost('/themes/store/ams-journal/install', { activate: 1 })).location, /AMS Journal is now your active theme/);
  const journal = await anon('/');
  assert.match(journal.text, /class="masthead"/, 'Journal renders its masthead');
  assert.match(journal.text, /masthead__kicker">Notes, essays/, 'its own theme setting reaches the page');
  assert.match((await get(`${admin}/themes/preview/ams-journal`)).text, /id="theme-preview-frame"/, 'the live preview page renders');
  assert.match((await adminPost('/themes/store/ams-portfolio/install', { activate: 1 })).location, /AMS Portfolio is now your active theme/);
  const portfolio = await anon('/');
  assert.match(portfolio.text, /class="hero__title">Design with intent/, 'Portfolio renders its hero setting');
  assert.match(portfolio.text, /class="grid"/, 'and its grid');
  assert.match(portfolio.text, /--cols:3/, 'the grid-columns setting reaches the CSS');
  assert.match((await adminPost('/themes/store/default/install', { activate: 1 })).location, /AMS Base is now your active theme/);
  assert.match((await anon('/')).text, /class="site-header"/);
  log('store lists 3 themes; Pro and Premium render home, blog, post, page and 404 with tabs + footer; switched back to Base');
});

test('12d. comments: public form, moderation, approval, replies, spam and delete', async () => {
  const saved = await adminPost('/settings', { ...SITE_SETTINGS, comments_enabled: 1, comments_require_approval: 1 });
  assert.match(saved.location, /Settings saved/);

  const url = currentPostUrl();
  const page = await anon(url);
  assert.match(page.text, /class="comment-form"/, 'the form is on the post');
  assert.match(page.text, /id="comments"/);
  const token = fieldValue(page.text, 'token');
  const contentId = fieldValue(page.text, 'content_id');

  // A wrong token is refused and stores nothing.
  const forged = await anonPost('/comments', { content_id: contentId, token: '1.bad', name: 'Bot', email: 'bot@example.com', body: 'spam' });
  assert.match(forged.location, /comment=failed/);
  // The honeypot is refused too.
  const honey = await anonPost('/comments', { content_id: contentId, token, name: 'Bot', email: 'bot@example.com', body: 'spam', website: 'http://spam.example' });
  assert.match(honey.location, /comment=failed/);

  const sent = await anonPost('/comments', {
    content_id: contentId, token, name: 'Visitor One', email: 'visitor@example.com',
    body: 'Great post! <b>not html</b>', website: '',
  });
  assert.match(sent.location, /comment=pending/, 'comments wait for moderation');
  assert.doesNotMatch((await anon(url)).text, /Great post!/, 'a pending comment is not public');

  const dash = await get(admin);
  assert.match(dash.text, /class="rail__bubble" title="1 pending"/, 'sidebar shows the pending count');

  const panel = await get(`${admin}/comments?status=pending`);
  assert.match(panel.text, /Visitor One/);
  assert.match(panel.text, /Great post!/);
  const commentId = Number(panel.text.match(/comments\/(\d+)\/status/)[1]);

  const approved = await adminPost(`/comments/${commentId}/status`, { status: 'approved', from: 'pending' });
  assert.match(approved.location, /ok=Comment[+ ]Approved/);
  const live = await anon(url);
  assert.match(live.text, /Great post!/, 'approved comments are public');
  assert.match(live.text, /&lt;b&gt;not html&lt;\/b&gt;/, 'comment text is escaped');
  assert.doesNotMatch(live.text, /<b>not html<\/b>/);

  const reply = await adminPost(`/comments/${commentId}/reply`, { body: 'Thanks for reading!', from: 'all' });
  assert.match(reply.location, /ok=Reply/);
  const withReply = await anon(url);
  assert.match(withReply.text, /Thanks for reading!/);
  assert.match(withReply.text, /comment-staff/);
  assert.match(withReply.text, /<ol class="children">/);

  await adminPost(`/comments/${commentId}/status`, { status: 'spam', from: 'all' });
  assert.doesNotMatch((await anon(url)).text, /Great post!/, 'spam is hidden');
  await adminPost(`/comments/${commentId}/status`, { status: 'approved', from: 'spam' });
  assert.match((await anon(url)).text, /Great post!/);

  assert.equal((await adminPost(`/comments/${commentId}/delete`, {})).status, 303);
  assert.doesNotMatch((await anon(url)).text, /Great post!/, 'deleted comments disappear');
  log(`comment #${commentId} submitted anonymously, held for review, approved, replied to, marked spam and deleted`);
});

test('12e. users: create an author, role limits, switch roles and delete', async () => {
  const made = await adminPost('/users/save', {
    username: 'author-e2e', email: 'author-e2e@example.com', role: 'author', password: 'author password',
  });
  assert.match(made.location, /can.now.sign.in/);
  const usersPage = await get(`${admin}/users`);
  assert.match(usersPage.text, /author-e2e/);
  const authorId = Number(usersPage.text.match(new RegExp(`${admin}/users/(\\d+)"><b>author-e2e<`))[1]);

  const dup = await adminPost('/users/save', { username: 'author-e2e', email: 'other@example.com', role: 'author', password: 'another password' });
  assert.equal(dup.status, 200, 'a duplicate username re-renders the form');
  assert.match(dup.text, /already taken/);

  await adminPost('/login', { login: 'author-e2e', password: 'author password' });
  assert.equal((await get(`${admin}/posts`)).status, 200, 'authors keep their posts');
  const authorPosts = await get(`${admin}/posts`);
  assert.doesNotMatch(authorPosts.text, /Launch Day &amp; More/, 'authors only see their own posts in the table');
  const hiddenBulk = await adminPost('/posts/bulk', { action: 'delete', ids: [state.postId] });
  assert.match(hiddenBulk.location, /err=/, 'bulk actions cannot change another author’s post');
  assert.equal((await anon(currentPostUrl())).status, 200, 'the other author’s post remains published');
  assert.equal((await get(`${admin}/pages`)).status, 403, 'authors cannot manage pages');
  assert.equal((await get(`${admin}/settings`)).status, 403, 'authors cannot open settings');
  assert.equal((await get(`${admin}/users`)).status, 403, 'authors cannot open users');
  assert.equal((await get(`${admin}/updates`)).status, 403, 'authors cannot open updates');
  assert.doesNotMatch((await get(admin)).text, /\/plugins">/, 'the sidebar hides admin sections for authors');

  await adminPost('/login', { login: ADMIN.username, password: ADMIN.password });
  assert.equal((await get(admin)).status, 200, 'back as admin');
  assert.match((await adminPost(`/users/${authorId}/delete`, {})).location, /deleted/);
  assert.doesNotMatch((await get(`${admin}/users`)).text, /author-e2e/);
  log('author created, could not reach pages/settings/users/updates, signed back in as admin and deleted');
});

test('12f. plugins and appearance: snippets, built-ins, custom CSS and widgets', async () => {
  assert.match((await adminPost('/plugins/save', {
    name: 'E2E Meta', hook: 'head', code: '<meta name="e2e-plugin" content="1">', enabled: 1,
  })).location, /saved/);
  assert.match((await anon('/')).text, /name="e2e-plugin"/, 'head snippet is injected');
  const pluginId = Number((await get(`${admin}/plugins`)).text.match(/plugins\/(\d+)\/toggle/)[1]);
  await adminPost(`/plugins/${pluginId}/toggle`, {});
  assert.doesNotMatch((await anon('/')).text, /name="e2e-plugin"/, 'inactive snippets disappear');
  await adminPost(`/plugins/${pluginId}/toggle`, {});
  assert.match((await anon('/')).text, /name="e2e-plugin"/, 'reactivating brings it back');

  assert.equal((await anon('/sitemap.xml')).status, 200);
  assert.match((await anon('/sitemap.xml')).text, /<urlset/);
  assert.match((await anon('/robots.txt')).text, /Sitemap: .*\/sitemap\.xml/);
  assert.match((await anon('/feed.xml')).text, /<rss version="2.0">/);
  await adminPost('/plugins/toggle', { key: 'sitemap' });
  assert.equal((await anon('/sitemap.xml')).status, 404, 'a deactivated built-in stops answering');
  assert.doesNotMatch((await anon('/robots.txt')).text, /Sitemap:/, 'robots drops the sitemap line');
  await adminPost('/plugins/toggle', { key: 'sitemap' });
  assert.equal((await anon('/sitemap.xml')).status, 200);

  assert.match((await adminPost('/appearance', {
    custom_css: '.e2e-custom{color:red}', custom_head: '<meta name="e2e-head" content="1">',
    custom_footer: '<div class="e2e-footer"></div>', custom_js: '',
  })).location, /\/appearance\?ok=Saved/);
  const styled = await anon('/');
  assert.match(styled.text, /\.e2e-custom\{color:red\}/);
  assert.match(styled.text, /name="e2e-head"/);
  assert.match(styled.text, /class="e2e-footer"/);

  assert.match((await adminPost('/widgets', {
    widget_footer_1_title: 'E2E Widget', widget_footer_1_body: '<p class="e2e-widget">Hello from a widget</p>',
  })).location, /\/widgets\?ok=Widgets saved/);
  const widgetPage = await anon('/');
  assert.match(widgetPage.text, /class="site-widgets site-widgets--footer"/, 'the classic footer area still renders');
  assert.match(widgetPage.text, /E2E Widget/);
  assert.match(widgetPage.text, /e2e-widget/);

  await adminPost(`/plugins/${pluginId}/delete`, {});
  assert.doesNotMatch((await anon('/')).text, /name="e2e-plugin"/);

  // Search Console Verification built-in: paste the whole Google tag, boom.
  assert.match((await get(`${admin}/plugins`)).text, /Search Console Verification/, 'verification plugin is listed as built-in');
  assert.match((await get(`${admin}/plugins`)).text, /\/plugins\/search-verification/, 'verification plugin has a Configure link');
  const verifyPage = await get(`${admin}/plugins/search-verification`);
  assert.match(verifyPage.text, /Google Search Console/, 'verification screen explains Google');
  assert.match(verifyPage.text, /Save &amp; activate/, 'verification screen is one paste-and-save form');
  assert.match((await adminPost('/plugins/search-verification', {
    verify_google: '<meta name="google-site-verification" content="e2eGoogleToken_123-ABC">',
    verify_bing: 'e2eBingToken1234567890',
    verify_yandex: '',
  })).location, /ok=/, 'pasting a full Google tag saves');
  const verifiedHome = await anon('/');
  assert.match(verifiedHome.text, /<meta name="google-site-verification" content="e2eGoogleToken_123-ABC">/, 'Google tag is live in <head>');
  assert.match(verifiedHome.text, /<meta name="msvalidate\.01" content="e2eBingToken1234567890">/, 'bare Bing code becomes a tag');
  await adminPost('/plugins/toggle', { key: 'search-verification' });
  assert.doesNotMatch((await anon('/')).text, /google-site-verification/, 'deactivating the plugin removes the tags');
  await adminPost('/plugins/toggle', { key: 'search-verification' });
  assert.match((await anon('/')).text, /google-site-verification/, 'reactivating brings the tags back');
  await adminPost('/plugins/search-verification', { verify_google: '', verify_bing: '', verify_yandex: '' });
  assert.doesNotMatch((await anon('/')).text, /google-site-verification/, 'clearing the code removes the tag');
  log('snippets inject/toggle/delete, sitemap+robots+RSS switch off and on, custom CSS/head/footer, footer widgets and Search Console verification render');
});

test('12g. tools: redirects, export/import, backups, health and cache', async () => {
  assert.match((await adminPost('/tools/redirects', { from_path: '/old-e2e', to_url: '/blog', status: '301' })).location, /saved/);
  const moved = await anon('/old-e2e');
  assert.equal(moved.status, 301);
  assert.equal(moved.location, '/blog');
  assert.match((await adminPost('/tools/redirects', { from_path: 'bad path', to_url: '/blog' })).location, /err=/);

  const exported = await get(`${admin}/tools/export/download`);
  const bundle = JSON.parse(exported.text);
  assert.equal(bundle.format, 'edge-cms-backup');
  assert.ok(bundle.content.length >= 2, 'pages and posts are in the export');
  assert.ok(bundle.users.every((u) => !('password_hash' in u)), 'passwords never leave the database');

  const body = new FormData();
  body.set('_csrf', await csrf());
  body.set('file', new File([exported.text], 'export.json', { type: 'application/json' }));
  const imported = await request(`${admin}/tools/import`, { method: 'POST', body });
  assert.match(imported.location, /ok=Imported/);
  const postText = (await anon(currentPostUrl())).text;
  assert.equal((postText.match(/Thanks for reading!/g) || []).length, 1, 'importing twice does not duplicate comments');

  assert.match((await adminPost('/tools/backups/create', {})).location, /ok=Backup/);
  const backupsPage = await get(`${admin}/tools/backups`);
  const backupId = Number(backupsPage.text.match(/backups\/(\d+)\/download/)[1]);
  const backup = await get(`${admin}/tools/backups/${backupId}/download`);
  assert.equal(JSON.parse(backup.text).format, 'edge-cms-backup');
  assert.match((await adminPost(`/tools/backups/${backupId}/delete`, {})).location, /deleted/);

  const health = await get(`${admin}/tools/health`);
  assert.match(health.text, /Site Health/);
  assert.match(health.text, /Database/);
  assert.match(health.text, /OK/);
  assert.match((await adminPost('/tools/cache', {})).location, /cache.cleared/);
  log('redirect served 301, export downloaded without hashes, re-import idempotent, backup created/downloaded/deleted, health green');
});

test('12h. updates and taxonomy management: version page, run updates, categories and tags', async () => {
  const page = await get(`${admin}/updates`);
  assert.equal(page.status, 200);
  const { APP_NAME } = await import('../src/lib/version.ts');
  assert.ok(page.text.includes(APP_NAME), 'the updates page names the app');
  assert.match(page.text, /Installed version<\/dt><dd>\d+\.\d+\.\d+/, 'the updates page states the running version');
  assert.match(page.text, /Database schema/);
  assert.match((await adminPost('/updates/run', {})).location, /\/updates\?ok=/);

  assert.match((await adminPost('/terms/new', { name: 'E2E Guides', taxonomy: 'category' })).location, /added/);
  const terms = await get(`${admin}/terms?taxonomy=category`);
  assert.match(terms.text, /E2E Guides/);
  const termId = Number(terms.text.match(/terms\/(\d+)\/rename/)[1]);
  assert.match((await adminPost(`/terms/${termId}/rename`, { name: 'E2E Handbook', taxonomy: 'category' })).location, /Renamed/);
  assert.match((await get(`${admin}/terms?taxonomy=category`)).text, /E2E Handbook/);
  assert.match((await adminPost(`/terms/${termId}/delete`, { taxonomy: 'category' })).location, /deleted/);
  assert.doesNotMatch((await get(`${admin}/terms?taxonomy=category`)).text, /E2E Handbook/);

  assert.match((await adminPost('/terms/new', { name: 'e2e-tag', taxonomy: 'tag' })).location, /added/);
  assert.match((await get(`${admin}/terms?taxonomy=tag`)).text, /e2e-tag/);
  log('updates page reports version and runs migrations; categories create/rename/delete and tags add work');
});

test('12i. the sidebar has every admin section, its sub-menus and the collapse control', async () => {
  const dash = await get(admin);
  for (const path of ['/updates', '/posts', '/media', '/pages', '/comments', '/appearance', '/plugins', '/users', '/tools', '/settings', '/profile']) {
    assert.ok(dash.text.includes(`href="${admin}${path}"`), `sidebar links to ${path}`);
  }
  assert.match(dash.text, /Collapse Menu/);
  assert.match(dash.text, /class="rail__item" href="\/control-room" aria-current="page"/, 'Dashboard is highlighted');
  assert.match(dash.text, /id="side-c"/);
  assert.match(dash.text, /<a href="\/control-room\/profile">/, 'the account menu links to the profile');
  assert.match(dash.text, /class="usermenu"/, 'the account menu is in the top bar');
  assert.match(dash.text, /href="\/control-room\/preferences"/, 'preferences is reachable from the sidebar');

  // A section shows its sub-menu while it is open, like the WordPress admin.
  const posts = await get(`${admin}/posts`);
  for (const path of ['/posts/new', '/terms?taxonomy=category', '/terms?taxonomy=tag']) {
    assert.ok(posts.text.includes(`href="${admin}${path}"`), `Posts sub-menu links to ${path}`);
  }
  const appearance = await get(`${admin}/appearance`);
  for (const path of ['/themes', '/menus', '/widgets']) {
    assert.ok(appearance.text.includes(`href="${admin}${path}"`), `Appearance sub-menu links to ${path}`);
  }
  const tools = await get(`${admin}/tools`);
  for (const path of ['/tools/redirects', '/tools/export', '/tools/backups', '/tools/health']) {
    assert.ok(tools.text.includes(`href="${admin}${path}"`), `Tools sub-menu links to ${path}`);
  }
  const settingsPage = await get(`${admin}/settings`);
  for (const hash of ['#reading', '#discussion', '#domains']) {
    assert.ok(settingsPage.text.includes(`href="${admin}/settings${hash}"`), `Settings sub-menu links to ${hash}`);
  }
  assert.match((await get(`${admin}/media`)).text, /id="upload"/);

  for (const path of ['/updates', '/comments', '/appearance', '/plugins', '/users', '/tools', '/settings', '/widgets', '/terms?taxonomy=tag']) {
    assert.equal((await get(`${admin}${path}`)).status, 200, path);
  }
  log('11 sections and Profile are linked, sub-menus appear for the open section, every page opens');
});

test('12j. panel shell: cached assets, preferences, error boundary and page weight', async () => {
  // The stylesheets are served as cacheable assets, not inlined in every page.
  const dash = await get(admin);
  assert.doesNotMatch(dash.text.slice(0, dash.text.indexOf('</head>')), /<style>/, 'no inlined stylesheet in the panel');
  const links = [...dash.text.matchAll(/href="([^"]+\/assets\/[a-z]+\.css\?v=[^"]+)"/g)].map((m) => m[1]);
  assert.equal(links.length, 3, 'three stylesheets are linked');
  for (const href of links) {
    const sheet = await anon(href);
    assert.equal(sheet.status, 200, `${href} is served`);
    assert.match(sheet.headers.get('content-type'), /text\/css/);
    assert.match(sheet.headers.get('cache-control'), /immutable/);
    const etag = sheet.headers.get('etag');
    assert.ok(etag, 'assets carry an ETag');
    const again = await request(href, { cookies: false, headers: { 'if-none-match': etag } });
    assert.equal(again.status, 304, 'a cached asset is revalidated without a body');
  }
  // The token layer really is in the tokens bundle.
  assert.match((await anon(links[0])).text, /--space-4:/);
  // Unknown assets 404 inside the admin instead of falling through to the site.
  assert.equal((await get(`${admin}/assets/nope.css`)).status, 404);

  // Preferences are cookies, applied server-side: no flash of the wrong scheme.
  const prefsPage = await get(`${admin}/preferences`);
  assert.equal(prefsPage.status, 200);
  assert.match(prefsPage.text, /Colour scheme/);
  const saved = await adminPost('/preferences', { scheme: 'dark', density: 'compact', railCollapsed: '1' });
  assert.match(saved.location, /preferences\?ok=/);
  const dark = await get(admin);
  assert.match(dark.text, /<html lang="en" data-scheme="dark" data-density="compact"/);
  assert.match(dark.text, /id="side-c"[^>]*checked/, 'the collapsed rail is rendered by the server');
  assert.ok(jar.get('ams_scheme') === 'dark', 'the scheme is remembered in a cookie');
  // A rejected value falls back to the safe default instead of being echoed.
  await adminPost('/preferences', { scheme: '<script>', density: 'huge', railCollapsed: '' });
  assert.match((await get(admin)).text, /data-scheme="auto" data-density="comfortable"/);
  // Back to the default for the remaining tests.
  await adminPost('/preferences', { scheme: 'auto', density: 'comfortable', railCollapsed: '' });

  // Page weight: the panel no longer carries ~31 KB of CSS in every response.
  const body = dash.text;
  const head = body.slice(0, body.indexOf('</head>'));
  assert.ok(head.length < 2000, `panel <head> is small (${head.length} bytes)`);

  // Icons are a sprite: every nav entry references a real symbol.
  const symbols = new Set([...body.matchAll(/<symbol id="i-([a-z-]+)"/g)].map((m) => m[1]));
  assert.ok(symbols.size > 20, 'the icon sprite is present');
  for (const used of new Set([...body.matchAll(/<use href="#i-([a-z-]+)"/g)].map((m) => m[1]))) {
    assert.ok(symbols.has(used), `icon ${used} exists in the sprite`);
  }
  assert.doesNotMatch(body, /\p{Extended_Pictographic}/u, 'no emoji left as UI icons');
  log('assets cached with ETag, preferences render server-side, sprite icons everywhere, no inline CSS');
});

test('13. deleting content and media removes them from the site', async () => {
  assert.equal((await adminPost(`/posts/${state.draftId}/delete`, {})).status, 303);
  assert.equal((await get('/blog/secret-draft?preview=1')).status, 404);
  assert.equal((await adminPost(`/pages/${state.pageId}/delete`, {})).status, 303);
  assert.equal((await anon('/about-us')).status, 404);
  assert.equal((await adminPost(`/media/${state.mediaId}/delete`, {})).status, 303);
  assert.equal((await anon(state.mediaUrl)).status, 404);
  const y = new Date().getUTCFullYear(), m = String(new Date().getUTCMonth() + 1).padStart(2, '0');
  const post = await anon(`/${y}/${m}/launch-day-more`);
  assert.equal(post.status, 200);
  assert.ok(!post.text.includes(state.mediaUrl), 'post no longer references the deleted image');
  log('page, draft and media deleted; post still renders without its image');
});

/* ==========================================================================
   Phase 2: the editor's durability features against the real server.
   ========================================================================== */
test('16. revisions, autosave, edit locks, quick edit and media picker', async () => {
  const created = await adminPost('/posts/save', { title: 'Durability Post', body: '<p>Version one.</p>', status: 'draft' });
  const id = Number(created.location.match(/\/posts\/(\d+)/)[1]);
  assert.ok(id, 'post created');

  // Revisions: each save snapshots what came before.
  await adminPost('/posts/save', { id, title: 'Durability Post', body: '<p>Version two.</p>', status: 'draft' });
  await adminPost('/posts/save', { id, title: 'Durability Post', body: '<p>Version three.</p>', status: 'published' });
  const history = await get(`${admin}/posts/${id}/revisions`);
  assert.equal(history.status, 200);
  assert.match(history.text, /class="revision revision--manual"/);
  const revIds = [...history.text.matchAll(/\/revisions\/(\d+)"/g)].map((m) => m[1]);
  assert.ok(revIds.length >= 2, 'more than one restore point');
  const oldest = revIds[revIds.length - 1];
  const compare = await get(`${admin}/posts/${id}/revisions/${oldest}`);
  assert.match(compare.text, /diff__line--(add|del)/, 'the diff shows the change');

  // Restore is reversible.
  const restore = await adminPost(`/posts/${id}/revisions/${oldest}/restore`, {});
  assert.match(restore.location, /Restored/);
  assert.match((await get(`${admin}/posts/${id}`)).text, /Version one\./);
  assert.match((await get(`${admin}/posts/${id}/revisions`)).text, /Restored/);

  // Autosave: stored, recoverable, never the live row.
  await adminPost('/posts/save', { id, title: 'Durability Post', body: '<p>Live version.</p>', status: 'published' });
  const autosave = await adminPost(`/posts/${id}/autosave`, { title: 'Durability Post', body: '<p>Unsaved typing.</p>' });
  assert.equal(autosave.status, 200);
  assert.equal(JSON.parse(autosave.text).ok, true);
  const editor = await get(`${admin}/posts/${id}`);
  assert.match(editor.text, /data-autosave-banner/, 'the newer autosave is offered back');
  assert.match(editor.text, /Live version\./, 'the live body is unchanged by the autosave');

  // Edit lock: the second session is warned, and an editor can take it over.
  const loginPage = await anon(`${admin}/login`);
  const lockCsrf = loginPage.text.match(/name="_csrf" value="([^"]+)"/)[1];
  await adminPost('/users/save', { username: 'locker', email: 'locker@example.com', password: 'secretpass3', role: 'editor' });
  const jar = new Map();
  const asLocker = async (path, init = {}) => {
    const headers = { ...(init.headers || {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    const res = await fetch(base + path, { ...init, headers, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
    }
    return { status: res.status, text: await res.text() };
  };
  const form = await asLocker(`${admin}/login`);
  const signIn = await asLocker(`${admin}/login`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: form.text.match(/name="_csrf" value="([^"]+)"/)[1], login: 'locker', password: 'secretpass3' }),
  });
  assert.equal(signIn.status, 303, 'the second editor signed in');
  const locked = await asLocker(`${admin}/posts/${id}`);
  assert.match(locked.text, /data-lock-banner/);
  assert.match(locked.text, /is editing this post/);
  assert.match(locked.text, /\/lock\/takeover/);
  assert.ok(lockCsrf);

  // Quick edit keeps you in the list; duplicate and pin act on the row.
  assert.match((await get(`${admin}/posts/${id}/quick`)).text, /id="qe-title"/);
  assert.match((await adminPost(`/posts/${id}/quick`, { title: 'Renamed Quickly', slug: 'renamed-quickly', status: 'published' })).location, /posts\?ok=/);
  const dup = await adminPost(`/posts/${id}/duplicate`, {});
  const copyId = Number(dup.location.match(/\/posts\/(\d+)/)[1]);
  assert.notEqual(copyId, id, 'the duplicate is a new post');
  assert.match((await get(`${admin}/posts/${copyId}`)).text, /Renamed Quickly \(copy\)/);
  await adminPost(`/posts/${id}/pin`, {});
  assert.match((await get(`${admin}/posts`)).text, /class="pin"/);

  // Media picker: JSON list, JSON upload with alt text, alt editing.
  assert.match((await get(`${admin}/posts/new`)).text, /id="media-picker"/);
  const picker = await get(`${admin}/media/picker`);
  assert.equal(picker.status, 200);
  assert.ok(Array.isArray(JSON.parse(picker.text).items));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form2 = new FormData();
  form2.set('_csrf', await csrf());
  form2.set('alt', 'Durability pixel');
  form2.set('file', new Blob([png], { type: 'image/png' }), 'durability.png');
  // The live browser posts the token from the page it is on, so the CSRF *seed*
  // cookie is already in the jar. Reuse the harness cookie jar so the token and
  // the seed belong together; a raw fetch with a hand-built jar would pair a
  // fresh token with a seed the server has never seen.
  form2.set('_csrf', await csrf());
  const upload = await request(`${admin}/media/picker/upload`, { method: 'POST', body: form2 });
  const uploadText = upload.text;
  assert.equal(upload.status, 200, `picker upload answered JSON, got ${upload.status}: ${uploadText.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(-300)}`);
  const uploaded = JSON.parse(uploadText);
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.item.alt, 'Durability pixel');
  assert.match((await get(`${admin}/media/picker?q=durability`)).text, /durability/);
  assert.match((await adminPost(`/media/${uploaded.item.id}/alt`, { alt: 'Better description' })).location, /media\?ok=/);

  // Page order + the theme's {{#each pages}} list share one order.
  await adminPost('/pages/save', { title: 'Ordered One', slug: 'ordered-one', body: '', status: 'published' });
  await adminPost('/pages/save', { title: 'Ordered Two', slug: 'ordered-two', body: '', status: 'published' });
  assert.match((await get(`${admin}/pages`)).text, new RegExp(`action="${admin}/pages/order"`), 'the pages screen carries the order form');
  log('revisions/restore, autosave, edit lock, quick edit, duplicate, pin, media picker and page order all work');
});

// Phase 4, over the wire, from the public site's side: a brand colour chosen in
// the Customizer changes a page without a save; a new theme's manifest settings
// become controls with no code change; a per-page template override renders.
test('13b. appearance: live preview, manifest settings, per-page template and widgets', async () => {
  // A theme that declares two settings, two widget areas and an extra template.
  const atlas = {
    name: 'Atlas E2E', slug: 'atlas-e2e', version: '1.0.0',
    templates: {
      base: '<!doctype html><html><head>{{{head}}}</head><body data-theme="atlas-e2e">{{{content}}}{{{widgets.footer}}}{{{footer}}}</body></html>',
      home: '<h1 class="atlas-hero">{{theme.hero}}</h1>',
      page: '<h1 class="atlas-page">{{page.title}}</h1>',
      'page-landing': '<section class="atlas-landing">{{{page.content}}}</section>',
    },
    css: ':root{--accent:#0055aa;--fg:#111;--bg:#fff} body{color:var(--fg)}',
    settings: [
      { key: 'hero', type: 'text', label: 'Hero words', default: 'Hello there' },
      { key: 'badge', type: 'toggle', label: 'Show a badge', default: true },
    ],
    widgets: ['footer', 'sidebar'],
  };
  assert.match((await uploadTheme('atlas-e2e.json', JSON.stringify(atlas))).location, /v1\.0\.0 installed/);
  const rows = (await get(`${admin}/themes`)).text;
  const id = rows.match(/data-theme-id="(\d+)"[^>]*data-theme-slug="atlas-e2e"/)[1];
  await adminPost(`/themes/${id}/activate`, {});

  // 1. Unsaved brand colour and theme setting → preview only.
  const preview = await request(`${admin}/appearance/preview`, {
    method: 'POST', body: form({ _csrf: await csrf(), token_brand: '#ff0066', hero: 'Preview hero' }),
  });
  assert.equal(preview.status, 200);
  assert.equal(JSON.parse(preview.text).ok, true);
  const framed = await get('/?preview=1&customize=1');
  assert.match(framed.text, /id="site-tokens">[^<]*#ff0066/, 'the unsaved colour is in the preview');
  assert.match(framed.text, /class="atlas-hero">Preview hero</, 'so is the unsaved theme setting');
  assert.equal(framed.headers.get('x-frame-options'), 'SAMEORIGIN', 'the panel may frame its own preview');
  const pub = await anon('/');
  assert.doesNotMatch(pub.text, /#ff0066/, 'nothing was saved by previewing');
  assert.match(pub.text, /class="atlas-hero">Hello there</);
  assert.equal(pub.headers.get('x-frame-options'), null, 'the public site stays unframeable');

  // 2. Save from the Customizer: the colour and the theme setting persist.
  await adminPost('/appearance', { token_brand: '#ff0066', hero: 'Saved hero', badge: '1', start_path: '/' });
  const saved = await anon('/');
  assert.match(saved.text, /--accent:#ff0066/);
  assert.match(saved.text, /class="atlas-hero">Saved hero</);

  // 3. Per-page template override renders on the public site.
  assert.match((await get(`${admin}/pages/new`)).text, /<option value="page-landing">/);
  await adminPost('/pages/save', {
    title: 'E2E Landing', slug: 'e2e-landing', body: '<p>Landing body</p>', status: 'published', template: 'page-landing',
  });
  assert.match((await anon('/e2e-landing')).text, /class="atlas-landing"><p>Landing body<\/p>/);
  await adminPost('/pages/save', { title: 'E2E Plain', slug: 'e2e-plain', body: '<p>Plain</p>', status: 'published' });
  assert.match((await anon('/e2e-plain')).text, /class="atlas-page">E2E Plain</, 'a page without an override keeps the default');

  // 4. Widget areas come from theme.json, and render where the theme allows.
  await adminPost('/widgets', {
    widget_footer_1_title: 'About', widget_footer_1_body: '<p>Footer widget</p>',
    widget_sidebar_1_body: '<p>Sidebar widget</p>',
  });
  const withWidgets = await anon('/e2e-plain');
  assert.match(withWidgets.text, /site-widgets--footer[\s\S]*Footer widget/);
  assert.match(withWidgets.text, /site-widgets--sidebar[\s\S]*Sidebar widget/);

  // 5. Identity: the social image and scheme reach every page.
  await adminPost('/identity', { site_logo: '', favicon: '/media/fav.png', social_image: '/media/share.png', token_scheme: 'dark', token_brand: '#ff0066' });
  const identity = await anon('/e2e-plain');
  assert.match(identity.text, /<meta property="og:image" content="[^"]*\/media\/share.png">/);
  assert.match(identity.text, /<meta name="color-scheme" content="dark">/);
  log('preview shows unsaved tokens + theme settings (never saved), the Customizer save persists both, a page renders its own template, widget areas from theme.json render, Identity reaches every page');
});

/* ==========================================================================
   The editor's writing surface, over the wire: what the toolbar, the image
   block and the paste path send is what the public page renders. The client
   side of the same features is proven in tests/editor.test.mjs; here the
   question is whether a saved body survives the server and reaches a theme.
   ========================================================================== */
test('17. the editor markup for images, links, blocks and breaks survives the save', async () => {
  const created = await adminPost('/posts/save', {
    title: 'Placed Image Post', status: 'published',
    body: [
      '<h2>A heading</h2>',
      '<p>Text with a <a href="https://example.com/report" target="_blank" rel="noopener noreferrer">link</a> and an <a href="mailto:hi@example.com">email</a>.</p>',
      '<figure class="image-block align-left" style="width:35%"><img src="/media/example/pic.webp" alt="A placed image" loading="lazy"><figcaption>Caption under it</figcaption></figure>',
      '<p>Text after a floated image.</p>',
      '<figure class="image-block align-center" style="width:50%"><a href="https://example.com/gallery"><img src="/media/example/pic.webp" alt="Linked image" loading="lazy"></a></figure>',
      '<hr class="page-break">',
      '<div class="html-block"><p>Custom block</p></div>',
      '<figure class="video-block youtube-video"><div class="video-responsive"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Clip" loading="lazy" allowfullscreen></iframe></div></figure>',
    ].join('\n'),
  });
  assert.equal(created.status, 303);
  const id = idFrom(created.location);
  const slug = ((await get(`${admin}/posts/${id}`)).text.match(/name="slug" value="([^"]*)"/) || [])[1];
  assert.ok(slug, 'the post has a slug');
  // The permalink style and the active theme are whatever earlier tests left
  // behind, so ask the site rather than assuming /blog/ and the bundled theme.
  const url = JSON.parse((await anon(`/api/posts/${slug}`)).text).url;
  // Render with a known theme: earlier tests leave a fixture theme active, and
  // this test is about the saved markup, not about which theme is current.
  const page = await get(`${url}?preview=1&theme=default`);
  assert.equal(page.status, 200, `${url} renders in the bundled theme`);

  // Alignment + width are the two things the editor's bar writes.
  assert.match(page.text, /<figure class="image-block align-left" style="width:35%">/);
  assert.match(page.text, /<figcaption>Caption under it<\/figcaption>/);
  assert.match(page.text, /<figure class="image-block align-center" style="width:50%">/);
  // The new-tab link keeps its rel (and never gains a second one).
  assert.match(page.text, /<a href="https:\/\/example.com\/report" target="_blank" rel="noopener noreferrer">link<\/a>/);
  assert.equal((page.text.match(/rel="noopener noreferrer"/g) || []).length,
    (page.text.match(/target="_blank"/g) || []).length, 'exactly one rel per new-tab link');
  // An in-page/mail link is left alone.
  assert.match(page.text, /<a href="mailto:hi@example.com">email<\/a>/);
  // A linked image keeps its anchor.
  assert.match(page.text, /<a href="https:\/\/example.com\/gallery"><img src="\/media\/example\/pic.webp" alt="Linked image"/);
  // The print break and the custom/video blocks are kept as written.
  assert.match(page.text, /<hr class="page-break">/);
  assert.match(page.text, /<div class="html-block"><p>Custom block<\/p><\/div>/);
  assert.match(page.text, /youtube-nocookie.com\/embed\/dQw4w9WgXcQ/);
  // The bundled themes style the break and the figure placement (the store
  // themes that earlier tests activate are CSS-only and render the markup
  // as-is, so the figure rules are checked in the stylesheet itself).
  const defaultCss = (await anon('/theme-assets/default/style.css')).text || '';
  assert.match(defaultCss, /hr\.page-break\{border-top-style:dashed/);
  assert.match(defaultCss, /figure\.image-block\{margin:1\.5em auto/);

  // An admin saves raw HTML by design; an author or editor goes through the
  // sanitizer, which keeps exactly the declarations the editor writes and
  // drops a width it cannot produce (250%) rather than shipping a broken
  // layout. The figure styles are checked against that same sanitizer.
  const { sanitizeHtml } = await import('../src/lib/security.ts');
  assert.equal(
    sanitizeHtml('<figure class="image-block align-center" style="width:250%"><img src="/a.png" alt=""></figure>'),
    '<figure class="image-block align-center"><img src="/a.png" alt=""></figure>',
  );
  assert.equal(
    sanitizeHtml('<figure class="image-block align-center" style="width:35%"><img src="/a.png" alt=""></figure>'),
    '<figure class="image-block align-center" style="width:35%"><img src="/a.png" alt=""></figure>',
    'the width the editor writes survives the sanitizer',
  );
  assert.equal(
    sanitizeHtml('<p><a href="https://x.test" target="_blank">t</a></p>'),
    '<p><a href="https://x.test" target="_blank" rel="noopener noreferrer">t</a></p>',
    'a new-tab link gains exactly one rel',
  );

  // The editor page ships everything the toolbar promises.
  const editor = await get(`${admin}/posts/${id}`);
  for (const needle of [
    'id="link-dialog"', 'id="image-block-dialog"', 'id="insert-image-block"',
    'data-link-open', 'data-img-caption', 'data-img-alt', 'data-img-link',
    'id="add-page-break"', 'id="editor-stats"', 'id="slug-preview"',
    'window.amsEditorUtils', 'tidyHtml',
  ]) assert.ok(editor.text.includes(needle), `the editor ships ${needle}`);
  assert.match(editor.text, /Ctrl\/Cmd\+S saves|saveNow\(\)/, 'the save shortcut is wired');
  log('image placement, links, page breaks, HTML and video blocks save and render as placed');
});

test('14. logout ends the session and repeated bad logins are rate limited', async () => {
  const out = await adminPost('/logout', {});
  assert.match(out.location, /logged out/);
  assert.equal((await get(admin)).location, `${admin}/login`);
  const token = await csrf();
  const attempt = () => request(`${admin}/login`, { method: 'POST', body: form({ _csrf: token, login: ADMIN.username, password: 'guess' }) });
  for (let i = 0; i < 5; i++) assert.equal((await attempt()).status, 303);
  assert.equal((await attempt()).status, 429);
  const locked = await request(`${admin}/login`, { method: 'POST', body: form({ _csrf: token, login: ADMIN.username, password: ADMIN.password }) });
  assert.equal(locked.status, 429, 'even the right password is refused while locked');
  log('logged out; 6th failed login blocked with 429');
});

