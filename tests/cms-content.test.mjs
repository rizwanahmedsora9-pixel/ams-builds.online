import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const notCopied = new Set(['node_modules', 'dist', '.git', '.astro', '.wrangler', '.dev-cms']);

// Full production-stack proof: build the Worker, log in through its API, save
// CMS-shaped content + a real image, then read public URLs without a cookie or
// any browser storage. This guards against regressions to localStorage-only
// editing or static 404 pages that merely look published in one browser.
test('shared CMS saves render immediately for anonymous visitors after refresh', { timeout: 300_000 }, async (t) => {
  const site = await mkdtemp(join(tmpdir(), 'ams-cms-shared-'));
  const port = 8800 + (process.pid % 500);
  const base = `http://127.0.0.1:${port}`;
  let worker;
  let workerOutput = '';
  t.after(async () => {
    if (worker?.pid) {
      try { process.kill(-worker.pid, 'SIGTERM'); } catch { worker.kill('SIGTERM'); }
      await Promise.race([
        new Promise((resolve) => worker.once('exit', resolve)),
        pause(3000).then(() => { try { process.kill(-worker.pid, 'SIGKILL'); } catch {} }),
      ]);
    }
    await rm(site, { recursive: true, force: true });
  });

  await cp(root, site, {
    recursive: true,
    filter: (source) => !notCopied.has(relative(root, source).split(sep)[0]),
  });
  await symlink(join(root, 'node_modules'), join(site, 'node_modules'), 'junction');

  // Include files with the exact YAML date/empty-value shapes produced by the
  // editor, preserving the original schema regression coverage.
  await writeFile(join(site, 'src/content/blog/cms-saved-post.md'), `---\ntitle: CMS Saved File Post\ndescription: Created in the CMS.\npubDate: 2026-11-10\nupdatedDate: ""\nauthor: AMS Builds Team\nfeatured: false\nnoindex: false\ndraft: false\n---\nBody typed in the editor.\n`);
  await writeFile(join(site, 'src/content/pages/cms-saved-page.md'), `---\ntitle: Pricing\ndescription: Pricing page\nnoindex: false\nnavOrder: ""\nshowInNav: true\nshowInFooter: false\ndraft: false\nupdatedDate: 2026-11-10\n---\nOur pricing.\n`);

  try {
    await run(process.execPath, [join(root, 'node_modules', 'astro', 'astro.js'), 'build'], {
      cwd: site,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    assert.fail(`astro build failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
  }

  worker = spawn(process.execPath, [join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'dev', '--local', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: site,
    detached: true,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout.on('data', (chunk) => { workerOutput += chunk; });
  worker.stderr.on('data', (chunk) => { workerOutput += chunk; });

  let ready = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    if (worker.exitCode !== null) break;
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) { ready = true; break; }
    } catch {}
    await pause(250);
  }
  assert.ok(ready, `Worker did not start:\n${workerOutput.slice(-4000)}`);

  const jsonHeaders = {
    'content-type': 'application/json',
    'x-requested-with': 'ams-admin',
    origin: base,
  };
  const firstBadLogin = await fetch(`${base}/admin/api/login`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ username: 'attacker', password: 'chosen-by-attacker' }),
  });
  assert.equal(firstBadLogin.status, 401, 'an anonymous visitor cannot claim a fresh CMS');

  const login = await fetch(`${base}/admin/api/login`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ username: 'admin', password: 'admin12345' }),
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const authHeaders = { ...jsonHeaders, cookie };

  const badLogin = await fetch(`${base}/admin/api/login`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
  });
  assert.equal(badLogin.status, 401);

  const pageData = {
    title: 'Shared Proof Page', description: 'Shared storage verification',
    heroTitle: 'Shared Page Is Live', heroSubtitle: 'No browser storage required',
    featuredImage: '/images/uploads/shared-proof.jpg', navOrder: 1,
    showInNav: true, showInFooter: true, draft: false,
    updatedDate: '', seoTitle: '', seoDescription: '', ogImage: '', noindex: false,
  };
  const postData = {
    title: 'Shared Proof Post', description: 'Anonymous visitors can read this immediately',
    pubDate: '2026-11-11', updatedDate: '', author: 'AMS Builds Team', tags: ['CMS', 'Proof'],
    heroImage: '/images/uploads/shared-proof.jpg', featured: true, draft: false,
    seoTitle: '', seoDescription: '', ogImage: '', noindex: false,
  };
  for (const [type, slug, data, body] of [
    ['pages', 'shared-proof-page', pageData, '## Shared page body\n\nVisible after refresh.'],
    ['blog', 'shared-proof-post', postData, '## Shared post body\n\nVisible after refresh.'],
  ]) {
    const response = await fetch(`${base}/admin/api/entry`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ type, slug, data, body }),
    });
    assert.equal(response.status, 200, await response.text());
  }

  const imageBytes = await readFile(join(root, 'public/images/uploads/demo-business-site.jpg'));
  const form = new FormData();
  form.append('file', new File([imageBytes], 'Shared Proof.jpg', { type: 'image/jpeg' }));
  const upload = await fetch(`${base}/admin/api/media`, {
    method: 'POST',
    headers: { cookie, 'x-requested-with': 'ams-admin', origin: base },
    body: form,
  });
  const uploadResult = await upload.json();
  assert.equal(upload.status, 201, JSON.stringify(uploadResult));
  assert.equal(uploadResult.path, '/images/uploads/shared-proof.jpg');

  const settingsEntry = await fetch(`${base}/admin/api/entry?type=settings`, { headers: { cookie } });
  const settings = (await settingsEntry.json()).entry.data;
  const updatedSettings = { ...settings, heroTitle: 'Shared Settings Are Live', heroImage: '/images/uploads/shared-proof.jpg' };
  const saveSettings = await fetch(`${base}/admin/api/entry`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ type: 'settings', slug: 'site', data: updatedSettings, body: '' }),
  });
  assert.equal(saveSettings.status, 200);

  // No cookie, localStorage, IndexedDB or script execution is used by fetch.
  // A new URL must be genuine HTTP 200 HTML from the Worker, not a 404 shell.
  for (let refresh = 0; refresh < 2; refresh++) {
    const page = await fetch(`${base}/shared-proof-page/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('cache-control'), /no-store/);
    const html = await page.text();
    assert.match(html, /Shared Page Is Live/);
    assert.match(html, /Shared page body/);
    assert.match(html, /\/images\/uploads\/shared-proof.jpg/);

    const post = await fetch(`${base}/blog/shared-proof-post/`);
    assert.equal(post.status, 200);
    const postHtml = await post.text();
    assert.match(postHtml, /Shared Proof Post/);
    assert.match(postHtml, /<time datetime="2026-11-11">/);
    assert.match(postHtml, /Shared post body/);
  }

  const home = await fetch(`${base}/`);
  const homeHtml = await home.text();
  assert.match(homeHtml, /Shared Settings Are Live/);
  assert.match(homeHtml, /href="\/shared-proof-page\/"/);
  assert.match(homeHtml, /src="\/images\/uploads\/shared-proof.jpg"/);

  const blogIndex = await fetch(`${base}/blog/`).then((response) => response.text());
  assert.match(blogIndex, /Shared Proof Post/);
  const image = await fetch(`${base}/images/uploads/shared-proof.jpg`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.ok(Buffer.from(await image.arrayBuffer()).equals(imageBytes), 'uploaded image bytes are served exactly');

  const feed = await fetch(`${base}/rss.xml`).then((response) => response.text());
  assert.match(feed, /Shared Proof Post/);
  assert.match(feed, /<pubDate>Wed, 11 Nov 2026 00:00:00 GMT<\/pubDate>/);
  const sitemap = await fetch(`${base}/sitemap.xml`).then((response) => response.text());
  assert.match(sitemap, /\/shared-proof-page\//);
  assert.match(sitemap, /\/blog\/shared-proof-post\//);

  // The CMS-shaped repository files also render with normalized dates.
  const filePost = await fetch(`${base}/blog/cms-saved-post/`).then((response) => response.text());
  assert.match(filePost, /<time datetime="2026-11-10">/);
  assert.doesNotMatch(filePost, /article:modified_time/);
  const filePage = await fetch(`${base}/cms-saved-page/`).then((response) => response.text());
  assert.match(filePage, /Our pricing\./);

  for (const [type, slug] of [['pages', 'shared-proof-page'], ['blog', 'shared-proof-post']]) {
    const response = await fetch(`${base}/admin/api/entry?type=${type}&slug=${slug}`, {
      method: 'DELETE', headers: authHeaders,
    });
    assert.equal(response.status, 200);
  }
  const removed = await fetch(`${base}/shared-proof-page/`);
  assert.equal(removed.status, 404);
  assert.match(await removed.text(), /Page not found/);
});
