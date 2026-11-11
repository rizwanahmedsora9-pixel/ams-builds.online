import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter, serializeFrontmatter, parseDataFile, normalizeYamlValues } from '../src/lib/yaml.mjs';
import { slugify, isValidSlug, mediaFileName } from '../src/lib/slug.mjs';
import { hashPassword, verifyPassword, timingSafeEqual } from '../src/lib/password.mjs';
import { mergeEntries, mergeSettings } from '../src/lib/merge.mjs';
import { buildExportPayload } from '../src/lib/export-filter.mjs';
import { validateEntry, validateSettings, defaultData } from '../src/lib/fields.mjs';
import { deployHookUrl, triggerPublish } from '../src/lib/publish.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

// ── frontmatter ─────────────────────────────────────────────────────────
test('frontmatter round-trips: unquoted YAML dates become YYYY-MM-DD strings', () => {
  const raw = '---\ntitle: Hello\npubDate: 2026-11-10\ndraft: false\ntags:\n  - a\n---\nBody **here**.\n';
  const { data, body } = parseFrontmatter(raw);
  assert.equal(data.title, 'Hello');
  // js-yaml 5 keeps unquoted dates as text; either way the normaliser
  // produces the YYYY-MM-DD string the schemas expect.
  assert.equal(normalizeYamlValues(data.pubDate), '2026-11-10');
  assert.equal(body, 'Body **here**.\n');

  const text = serializeFrontmatter({ ...data, pubDate: '2026-11-10' }, body);
  const back = parseFrontmatter(text);
  assert.equal(back.data.pubDate, '2026-11-10');
  assert.equal(back.data.title, 'Hello');
  assert.deepEqual(back.data.tags, ['a', 'b'].slice(0, 1));
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

// ── passwords ───────────────────────────────────────────────────────────
test('password hash/verify round-trip', async () => {
  const hashed = await hashPassword('correct horse battery staple');
  assert.ok(hashed.salt && hashed.hash && hashed.it >= 100000);
  assert.equal(await verifyPassword('correct horse battery staple', hashed.salt, hashed.hash, hashed.it), true);
  assert.equal(await verifyPassword('wrong password', hashed.salt, hashed.hash, hashed.it), false);
  const hashed2 = await hashPassword('correct horse battery staple', hashed.salt);
  assert.equal(hashed2.salt, hashed.salt, 'salt is reused when provided');
  assert.equal(await verifyPassword('correct horse battery staple', hashed2.salt, hashed2.hash, hashed2.it), true);
});

test('timing-safe compare rejects different lengths and bytes', () => {
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2])), false);
});

// ── merge ───────────────────────────────────────────────────────────────
test('CMS overrides replace file entries and tombstones delete them', () => {
  const base = [
    { slug: 'a-post', type: 'blog', data: { title: 'From file' }, body: 'file body' },
    { slug: 'b-post', type: 'blog', data: { title: 'Other' }, body: 'other' },
  ];
  const merged = mergeEntries(base, [
    { slug: 'a-post', type: 'blog', frontmatter: { title: 'From CMS' }, body: 'cms body' },
    { slug: 'b-post', type: 'blog', deleted: true },
    { slug: 'c-post', type: 'blog', frontmatter: { title: 'Brand new' }, body: 'new' },
    { slug: '', type: 'blog', frontmatter: {} },
  ]);
  assert.deepEqual(merged.map((e) => e.slug), ['a-post', 'c-post']);
  assert.equal(merged[0].data.title, 'From CMS');
  assert.equal(merged[0].body, 'cms body');
  assert.equal(merged[1].type, 'blog');

  assert.deepEqual(mergeSettings({ siteName: 'file' }, { siteName: 'cms' }), { siteName: 'cms' });
  assert.deepEqual(mergeSettings({ siteName: 'file' }, null), { siteName: 'file' });
  assert.deepEqual(mergeSettings({ siteName: 'file' }, []), { siteName: 'file' });
});

// ── export filter ───────────────────────────────────────────────────────
test('export keeps published content, strips draft bodies, keeps tombstones', () => {
  const payload = buildExportPayload(
    [
      { slug: 'pub', type: 'blog', frontmatter: { title: 'Pub', draft: false }, body: 'full', updated_at: 't1', deleted: false },
      { slug: 'draft', type: 'blog', frontmatter: { title: 'Secret', draft: true, description: 'hidden' }, body: 'secret body', updated_at: 't2', deleted: false },
      { slug: 'gone', type: 'blog', frontmatter: { title: 'Gone' }, body: 'x', updated_at: 't3', deleted: true },
      { slug: 'site', type: 'settings', frontmatter: { siteName: 'AMS' }, body: '', updated_at: 't4', deleted: false },
    ],
    { siteName: 'AMS' },
  );
  const bySlug = Object.fromEntries(payload.entries.map((e) => [e.slug, e]));
  assert.equal(bySlug.pub.body, 'full');
  assert.equal(bySlug.pub.frontmatter.title, 'Pub');
  assert.equal(bySlug.draft.body, '', 'draft bodies never leave the worker');
  assert.deepEqual(Object.keys(bySlug.draft.frontmatter).sort(), ['draft', 'title']);
  assert.equal(bySlug.gone.deleted, true);
  assert.deepEqual(bySlug.gone.frontmatter, {});
  assert.equal(payload.settings.siteName, 'AMS');
  assert.equal(payload.entries.map((e) => e.slug).join(','), 'draft,gone,pub,site', 'sorted by slug');
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

// ── publish trigger ─────────────────────────────────────────────────────
test('deployHookUrl only accepts https hook URLs', () => {
  assert.equal(deployHookUrl({}), null);
  assert.equal(deployHookUrl({ CMS_DEPLOY_HOOK: 'http://insecure' }), null);
  assert.equal(deployHookUrl({ CMS_DEPLOY_HOOK: 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/x' }), 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/x');
});

test('triggerPublish reports missing hook, success and rate limits without throwing', async () => {
  const noHook = await triggerPublish({});
  assert.equal(noHook.ok, false);
  assert.equal(noHook.reason, 'no-hook');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: true, result: { build_uuid: 'abc', branch: 'main' } }), { status: 200 });
    const ok = await triggerPublish({ CMS_DEPLOY_HOOK: 'https://example.com/hook' });
    assert.equal(ok.ok, true);
    assert.equal(ok.buildUuid, 'abc');

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code: 10013, message: 'rate limited' }] }), { status: 403 });
    const limited = await triggerPublish({ CMS_DEPLOY_HOOK: 'https://example.com/hook' });
    assert.equal(limited.ok, false);
    assert.equal(limited.reason, 'rate-limited');

    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    const down = await triggerPublish({ CMS_DEPLOY_HOOK: 'https://example.com/hook' });
    assert.equal(down.ok, false);
    assert.equal(down.reason, 'network');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── configuration guards ────────────────────────────────────────────────
test('wrangler.jsonc wires the CmsSite Durable Object for prod and previews', async () => {
  const text = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const withoutComments = text.replace(/\/\/.*$/gm, '');
  const config = JSON.parse(withoutComments);
  assert.equal(config.main, './worker/main.js');
  assert.equal(config.assets.binding, 'ASSETS');
  assert.deepEqual(config.durable_objects.bindings, [{ name: 'CMS', class_name: 'CmsSite' }]);
  assert.deepEqual(config.migrations, [{ tag: 'v1', new_sqlite_classes: ['CmsSite'] }]);
  assert.deepEqual(config.previews.durable_objects.bindings, [{ name: 'CMS', class_name: 'CmsSite' }]);
});

test('astro.config serves content statically and the admin dynamically', async () => {
  const text = await readFile(new URL('../astro.config.mjs', import.meta.url), 'utf8');
  assert.match(text, /output:\s*'server'/);
  assert.match(text, /adapter:\s*cloudflare\(/);
  assert.match(text, /platformProxy:\s*\{\s*enabled:\s*false\s*\}/);
  assert.doesNotMatch(text, /decap|oauth/i, 'no Decap/GitHub OAuth middleware left in the config');
});

test('the worker entry re-exports the Astro app and the DO class', async () => {
  const main = await readFile(new URL('../worker/main.js', import.meta.url), 'utf8');
  assert.match(main, /export \{ CmsSite \}/);
  assert.match(main, /dist\/_worker\.js\/index\.js/);
  const cmsDo = await readFile(new URL('../worker/cms-do.js', import.meta.url), 'utf8');
  assert.match(cmsDo, /class CmsSite extends DurableObject/);
  assert.doesNotMatch(cmsDo, /github|oauth/i);
});
