import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseFrontmatter, serializeFrontmatter, parseDataFile, normalizeYamlValues } from '../src/lib/yaml.mjs';
import { slugify, isValidSlug, mediaFileName } from '../src/lib/slug.mjs';
import { mergeEntries, mergeSettings } from '../src/lib/merge.mjs';
import { validateEntry, validateSettings, defaultData, suggestSlug } from '../src/lib/fields.mjs';
import { renderMarkdownClient } from '../src/lib/markdown-browser.mjs';
import {
  AUTH_USER,
  AUTH_PASS,
  createClientCms,
} from '../src/lib/cms-store.mjs';

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    clear() {
      map.clear();
    },
  };
}

const sampleBaseline = {
  entries: [
    {
      type: 'blog',
      slug: 'first-post',
      data: {
        title: 'First Post',
        description: 'Baseline post description',
        pubDate: '2026-11-10',
        author: 'AMS Builds Team',
        tags: ['Web'],
        draft: false,
      },
      body: 'Hello from **baseline**.',
    },
    {
      type: 'pages',
      slug: 'about',
      data: {
        title: 'About',
        description: 'About AMS Builds',
        showInNav: true,
        showInFooter: true,
        navOrder: 3,
        draft: false,
      },
      body: 'We build websites.',
    },
    {
      type: 'projects',
      slug: 'sample-app',
      data: {
        title: 'Sample App',
        description: 'Case study',
        category: 'android',
        date: '2026-11-01',
        featured: true,
        draft: false,
      },
      body: 'Built fast.',
    },
  ],
  settings: {
    siteName: 'AMS Builds',
    shortDescription: 'Web & App agency',
    email: 'hello@ams-builds.online',
    phone: '+92 300 0000000',
    stats: [{ value: '50+', label: 'Projects' }],
    adsenseEnabled: false,
  },
  media: [
    { path: '/images/uploads/hero-dashboard.jpg', url: '/images/uploads/hero-dashboard.jpg', source: 'file' },
  ],
};

// ── frontmatter ─────────────────────────────────────────────────────────
test('frontmatter round-trips: unquoted YAML dates become YYYY-MM-DD strings', () => {
  const raw = '---\ntitle: Hello\npubDate: 2026-11-10\ndraft: false\ntags:\n  - a\n---\nBody **here**.\n';
  const { data, body } = parseFrontmatter(raw);
  assert.equal(data.title, 'Hello');
  assert.equal(normalizeYamlValues(data.pubDate), '2026-11-10');
  assert.equal(body, 'Body **here**.\n');

  const text = serializeFrontmatter({ ...data, pubDate: '2026-11-10' }, body);
  const back = parseFrontmatter(text);
  assert.equal(back.data.pubDate, '2026-11-10');
  assert.equal(back.data.title, 'Hello');
  assert.deepEqual(back.data.tags, ['a']);
  assert.equal(back.body, body);
});

test('data files (site.yml style) parse as plain YAML', () => {
  const data = parseDataFile('siteName: AMS Builds\nstats:\n  - value: "120+"\n    label: Projects\n');
  assert.equal(data.siteName, 'AMS Builds');
  assert.deepEqual(data.stats, [{ value: '120+', label: 'Projects' }]);
});

// ── slugs ───────────────────────────────────────────────────────────────
test('slug rules', () => {
  assert.equal(slugify('My New Post!'), 'my-new-post');
  assert.equal(slugify('  Café  Prices  '), 'cafe-prices');
  assert.ok(isValidSlug('why-gujrat-business-needs-website'));
  assert.ok(!isValidSlug('Has Spaces'));
  assert.ok(!isValidSlug('-leading'));
  assert.ok(!isValidSlug('trailing-'));
  assert.ok(!isValidSlug(''));
  assert.equal(mediaFileName('My Photo.JPG', new Set()), 'my-photo.jpg');
  assert.equal(mediaFileName('photo.png', new Set(['photo.png'])), 'photo-2.png');
  assert.equal(mediaFileName('evil.svg', new Set()), 'evil.jpg', 'non-image extensions fall back to jpg');
});

// ── merge (scoped by type:slug so different collections never collide) ──
test('CMS overrides replace file entries and tombstones delete them per type+slug', () => {
  const base = [
    { slug: 'a-post', type: 'blog', data: { title: 'Blog A' }, body: 'file body' },
    { slug: 'a-post', type: 'pages', data: { title: 'Page A' }, body: 'page body' },
    { slug: 'b-post', type: 'blog', data: { title: 'Other' }, body: 'other' },
  ];
  const merged = mergeEntries(base, [
    { slug: 'a-post', type: 'blog', frontmatter: { title: 'From CMS' }, body: 'cms body' },
    { slug: 'b-post', type: 'blog', deleted: true },
    { slug: 'c-post', type: 'blog', frontmatter: { title: 'Brand new' }, body: 'new' },
    { slug: '', type: 'blog', frontmatter: {} },
  ]);
  assert.deepEqual(
    merged.map((e) => `${e.type}:${e.slug}`),
    ['blog:a-post', 'pages:a-post', 'blog:c-post'],
  );
  assert.equal(merged[0].data.title, 'From CMS');
  assert.equal(merged[0].body, 'cms body');
  assert.equal(merged[1].data.title, 'Page A');

  assert.deepEqual(mergeSettings({ siteName: 'file' }, { siteName: 'cms' }), { siteName: 'cms' });
  assert.deepEqual(mergeSettings({ siteName: 'file' }, null), { siteName: 'file' });
  assert.deepEqual(mergeSettings({ siteName: 'file' }, []), { siteName: 'file' });
});

// ── save-time validation ────────────────────────────────────────────────
test('entry validation catches missing required fields and bad dates', () => {
  const blogDefaults = defaultData('blog');
  assert.deepEqual(validateEntry('blog', { ...blogDefaults, title: 'T', description: 'D', pubDate: '2026-11-10' }, 'body'), []);
  assert.ok(validateEntry('blog', { ...blogDefaults, title: '', description: 'D', pubDate: '2026-11-10' }, 'body').length > 0);
  assert.ok(validateEntry('blog', { ...blogDefaults, title: 'T', description: 'D', pubDate: 'not-a-date' }, 'body').length > 0);
  assert.ok(validateEntry('blog', { ...blogDefaults, title: 'T', description: 'D', pubDate: '2026-11-10', tags: [1] }, 'body').length > 0);

  assert.deepEqual(validateEntry('projects', { ...defaultData('projects'), title: 'P', description: 'D', date: '2026-01-01', category: 'web' }, ''), []);
  assert.ok(validateEntry('projects', { ...defaultData('projects'), title: 'P', description: 'D', date: '2026-01-01', category: 'blockchain' }, '').length > 0);

  assert.deepEqual(validateEntry('pages', { ...defaultData('pages'), title: 'P', description: '' }, ''), []);
  assert.ok(validateEntry('nope', {}, '').length > 0);
});

test('settings validation requires the brand/contact basics', () => {
  const data = {
    siteName: 'AMS Builds',
    shortDescription: 'x',
    email: 'a@b.c',
    phone: '+92',
    stats: [{ value: '1+', label: 'Projects' }],
    adsenseEnabled: false,
  };
  assert.deepEqual(validateSettings(data), []);
  assert.ok(validateSettings({ ...data, siteName: '' }).length > 0);
  assert.ok(validateSettings({ ...data, stats: 'nope' }).length > 0);
  assert.ok(validateSettings({ ...data, adsenseEnabled: 'yes' }).length > 0);
});

// ── markdown client sanitization ────────────────────────────────────────
test('renderMarkdownClient renders safe HTML and strips dangerous XSS vectors', () => {
  const html = renderMarkdownClient('# Hello\n\n<script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(2)">\n\n[ok](https://ams-builds.online) [bad](javascript:alert(3))');
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror=/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /href="https:\/\/ams-builds\.online"/);
});

// ── client-side CMS store & hardcoded admin auth ────────────────────────
test('hardcoded admin credentials enforce admin / admin12345', () => {
  assert.equal(AUTH_USER, 'admin');
  assert.equal(AUTH_PASS, 'admin12345');

  const storage = makeMemoryStorage();
  const cms = createClientCms({ baseline: sampleBaseline, storage });
  assert.equal(cms.getSession().authenticated, false);
  assert.equal(cms.login('admin', 'badpass').ok, false);
  assert.equal(cms.login('other', 'admin12345').ok, false);
  assert.equal(cms.getSession().authenticated, false);

  const ok = cms.login('admin', 'admin12345');
  assert.equal(ok.ok, true);
  assert.equal(cms.getSession().authenticated, true);
  assert.equal(cms.getSession().user, 'admin');

  // Re-instantiating with same storage keeps the session until logout
  const cms2 = createClientCms({ baseline: sampleBaseline, storage });
  assert.equal(cms2.getSession().authenticated, true);
  cms2.logout();
  assert.equal(cms2.getSession().authenticated, false);
});

test('client CMS CRUD: create, edit, revert, delete tombstone, settings, media & backup', async () => {
  const storage = makeMemoryStorage();
  const cms = createClientCms({ baseline: sampleBaseline, storage });

  // Initially matches baseline
  assert.equal(cms.listContent('blog').length, 1);
  assert.equal(cms.getEntry('blog', 'first-post').source, 'file');

  // Invalid slug is rejected cleanly
  assert.equal(
    cms.saveEntry('blog', 'Bad Slug!', { ...defaultData('blog'), title: 'T', description: 'D', pubDate: '2026-11-11' }, 'b').ok,
    false,
  );

  // Create new post with suggested slug
  const created = cms.saveEntry(
    'blog',
    suggestSlug('Second Post!'),
    {
      ...defaultData('blog'),
      title: 'Second Post!',
      description: 'Desc',
      pubDate: '2026-11-11',
    },
    'New body',
  );
  assert.equal(created.ok, true);
  assert.equal(created.slug, 'second-post');
  assert.equal(cms.listContent('blog').length, 2);

  // Edit baseline post and revert
  const edited = cms.saveEntry(
    'blog',
    'first-post',
    { ...cms.getEntry('blog', 'first-post').data, title: 'Updated First Post' },
    'Updated body',
  );
  assert.equal(edited.ok, true);
  assert.equal(cms.getEntry('blog', 'first-post').source, 'cms');
  assert.equal(cms.getEntry('blog', 'first-post').data.title, 'Updated First Post');
  assert.match(cms.formatEntryMarkdown('blog', 'first-post'), /title: Updated First Post/);

  cms.revertEntry('blog', 'first-post');
  assert.equal(cms.getEntry('blog', 'first-post').data.title, 'First Post');

  // Delete baseline post (tombstone hides it without losing baseline reference)
  cms.deleteEntry('blog', 'first-post');
  assert.equal(cms.getEntry('blog', 'first-post'), null);
  assert.deepEqual(
    cms.listContent('blog').map((p) => p.slug),
    ['second-post'],
  );

  // Settings edit & YAML export
  const savedSettings = cms.saveSettings({
    ...cms.getSettings().data,
    siteName: 'AMS Studio',
  });
  assert.equal(savedSettings.ok, true);
  assert.equal(cms.getSettings().data.siteName, 'AMS Studio');
  assert.match(cms.formatSettingsYaml(), /siteName: AMS Studio/);

  // Upload media (falls back gracefully to storage without IndexedDB)
  const up = await cms.uploadMedia({
    name: 'My Banner.png',
    type: 'image/png',
    size: 1024,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  });
  assert.equal(up.ok, true);
  assert.equal(up.path, '/images/uploads/my-banner.png');
  const media = await cms.listMedia();
  assert.ok(media.some((m) => m.path === '/images/uploads/my-banner.png'));

  // Export & import round-trip into clean storage
  const backup = await cms.exportBackup();
  assert.equal(backup.version, 1);
  assert.equal(backup.media.length, 1);

  const storage2 = makeMemoryStorage();
  const restored = createClientCms({ baseline: sampleBaseline, storage: storage2 });
  const imp = await restored.importBackup(backup);
  assert.equal(imp.ok, true);
  assert.equal(restored.getSettings().data.siteName, 'AMS Studio');
  assert.equal(restored.getEntry('blog', 'first-post'), null);
  assert.equal(restored.getEntry('blog', 'second-post').data.title, 'Second Post!');
  assert.equal((await restored.listMedia()).length, 2);

  await restored.resetAll();
  assert.equal(restored.getSettings().data.siteName, 'AMS Builds');
  assert.equal(restored.getEntry('blog', 'first-post').data.title, 'First Post');
});

// ── configuration guards (static / Vercel-compatible) ───────────────────
test('astro.config builds static output with /admin prerendered and no server adapter', async () => {
  const text = await readFile(new URL('../astro.config.mjs', import.meta.url), 'utf8');
  assert.match(text, /output:\s*'static'/);
  assert.doesNotMatch(text, /@astrojs\/cloudflare|decap|oauth/i);
});

test('wrangler.jsonc serves the static dist directory cleanly', async () => {
  const text = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const withoutComments = text.replace(/\/\/.*$/gm, '');
  const config = JSON.parse(withoutComments);
  assert.equal(config.assets.directory, './dist');
  assert.equal(config.main, undefined);
});

test('admin page is statically prerendered and uses zero backend API routes', async () => {
  const astro = await readFile(new URL('../src/pages/admin.astro', import.meta.url), 'utf8');
  assert.match(astro, /export const prerender = true/);
  assert.match(astro, /admin-client\.js/);
  const client = await readFile(new URL('../src/lib/admin-client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /\/admin\/api\//);
  assert.match(client, /createClientCms/);
});
