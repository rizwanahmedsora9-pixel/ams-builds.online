// End-to-end test: boots a real server on an empty data folder, walks through
// the installer and the whole admin workflow over HTTP, and checks the public
// site after every step. The same steps run against both runtimes:
//
//   npm test                    Node.js server (SQLite + disk)
//   npm run test:cloudflare     Cloudflare runtime (wrangler dev: D1 + KV + R2)
//
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { crc32, deflateRawSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = process.env.TARGET === 'cloudflare' ? 'cloudflare' : 'node';
const ADMIN = { username: 'owner', email: 'owner@example.com', password: 'correct horse battery' };
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let dataDir, child, port, base;
let admin = '/admin-panel';
const jar = new Map();
const log = (msg) => console.log(`    · ${msg}`);

/* ------------------------------------------------------------------ server */
const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

async function startServer() {
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, TRUST_PROXY: '0' };
  const args = TARGET === 'node'
    ? ['--disable-warning=ExperimentalWarning', join(ROOT, 'dist', 'server.mjs')]
    : [join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--ip', '127.0.0.1', '--port', String(port),
       '--inspector-port', String(await freePort()), '--persist-to', dataDir, '--show-interactive-dev-session=false'];
  let output = '';
  child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${output}`);
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return res.json();
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not start within 60s:\n${output}`);
}

function stopServer() {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 4000).unref();
  });
}

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'edge-cms-e2e-'));
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const health = await startServer();
  console.log(`\n  target: ${TARGET}  url: ${base}  data: ${dataDir}`);
  console.log(`  health: ${JSON.stringify(health)}\n`);
});

after(async () => {
  await stopServer();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

/* -------------------------------------------------------------------- http */
async function request(path, { method = 'GET', body, cookies = true, headers = {} } = {}) {
  const h = { ...headers };
  if (cookies && jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(base + path, { method, body, headers: h, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (cookies) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (value === '' || /max-age=0/i.test(line)) jar.delete(name); else jar.set(name, value);
    }
  }
  const text = await res.text();
  const loc = res.headers.get('location');
  return { status: res.status, text, headers: res.headers, location: loc ? decodeURIComponent(loc.replace(base, '')) : null };
}
const get = (path, opts) => request(path, opts);
const anon = (path) => request(path, { cookies: false });
const form = (fields) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const item of [].concat(v)) p.append(k, String(item));
  return p;
};
async function csrf() {
  const page = await get(`${admin}/login`);
  const html = page.status === 200 ? page.text : (await get(`${admin}/profile`)).text;
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(m, 'CSRF token is present in the form');
  return m[1];
}
const adminPost = async (path, fields) => request(admin + path, { method: 'POST', body: form({ _csrf: await csrf(), ...fields }) });
const idFrom = (location) => Number(location.match(/\/(\d+)(\?|$)/)[1]);


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
  return request(`${admin}/themes/upload`, { method: 'POST', body });
}
const themeId = async (name) => Number((await get(`${admin}/themes`)).text.match(new RegExp(`themes/(\\d+)/download">${name}<`))[1]);
const nav = (htmlText) => [...htmlText.match(/<nav class="site-nav"[^]*?<\/nav>/)[0].matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => `${m[2]}=${m[1]}`);

/* ------------------------------------------------------------------- steps */
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
  assert.equal((await get(`${admin}/pages`)).text.includes('About Us'), true);
  assert.equal((await get(`${admin}/pages/999`)).status, 404);
  assert.equal((await get(`${admin}/pagesx`)).status, 404);
  log(`page #${state.pageId} live at /about-us, SEO tags rendered, edit visible without waiting`);
});

test('7. media: upload to storage, serve identical bytes, refuse unsafe types', async () => {
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
  assert.equal((await anon('/media/..%2F..%2Fcms.sqlite')).status, 404);
  log(`uploaded ${state.mediaUrl}, bytes match, .html upload skipped, path traversal blocked`);
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
  admin = '/control-room';
  assert.equal((await get(admin)).status, 200);
  const home = await anon('/');
  assert.match(home.text, /<title>Renamed Site – Now with a tagline<\/title>/);
  assert.equal((await anon('/blog/launch-day-more')).status, 404);
  const y = new Date().getUTCFullYear(), m = String(new Date().getUTCMonth() + 1).padStart(2, '0');
  assert.equal((await anon(`/${y}/${m}/launch-day-more`)).status, 200);
  assert.equal((await anon('/1999/01/launch-day-more')).location, `/${y}/${m}/launch-day-more`);
  const editor = await get(`${admin}/posts/${state.postId}`);
  assert.match(editor.text, /Publish date \(Asia\/Karachi\)/);
  log('title/tagline live, posts moved to /YYYY/MM/slug with redirect, admin moved to /control-room');
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
  await stopServer();
  await startServer();
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
  assert.match((await uploadTheme('json-theme.json', JSON.stringify(json))).location, /Json Theme" v2\.1\.0 saved/);
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
  assert.match((await uploadTheme('zip-theme.zip', zip)).location, /Zip Theme" v0\.9 saved/);
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

  const dl = await get(`${admin}/themes/${zipId}/download`);
  assert.match(dl.headers.get('content-disposition'), /zip-theme-theme\.json/);
  assert.equal(JSON.parse(dl.text).version, '1.0');

  assert.match((await adminPost(`/themes/${zipId}/delete`, {})).location, /Activate another theme/);
  const baseId = await themeId('AMS Base');
  await adminPost(`/themes/${baseId}/activate`, {});
  assert.match((await anon('/')).text, /class="site-header"/);
  assert.match((await adminPost(`/themes/${zipId}/delete`, {})).location, /Theme deleted/);
  assert.match((await adminPost(`/themes/${jsonId}/delete`, {})).location, /Theme deleted/);
  assert.equal(((await get(`${admin}/themes`)).text.match(/class="btn ghost small" href="[^"]+\/download"/g) || []).length, 1, 'only AMS Base is left');
  log('5 bad uploads rejected with reasons; JSON + zip themes installed, activated, replaced live, downloaded, deleted');
});

test('12c. theme store: AMS Base, AMS Pro and AMS Premium install and switch with one click', async () => {
  const store = await get(`${admin}/themes`);
  for (const name of ['AMS Base', 'AMS Pro', 'AMS Premium']) assert.ok(store.text.includes(`<h3>${name} `), name);
  assert.equal((store.text.match(/store\/[a-z-]+\/install/g) || []).length, 4, 'Pro and Premium each offer Install and Install-and-activate');

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
  assert.equal((after.text.match(/store\/[a-z-]+\/install/g) || []).length, 2, 'installed themes only offer Activate');
  assert.match((await adminPost('/themes/store/nope/install', {})).text, /not in the store/);
  assert.match((await adminPost('/themes/store/default/install', { activate: 1 })).location, /AMS Base is now your active theme/);
  assert.match((await anon('/')).text, /class="site-header"/);
  log('store lists 3 themes; Pro and Premium render home, blog, post, page and 404 with tabs + footer; switched back to Base');
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
