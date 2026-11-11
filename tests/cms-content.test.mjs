import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// The admin editor does not write front matter the way a person would. Two
// habits matter here:
//   • dates are saved without quotes (pubDate: 2026-11-10), which YAML reads
//     as a Date object rather than text;
//   • an optional field that the editor empties is saved as an empty string —
//     even the "Nav Order" number box (navOrder: "").
// If the schemas in src/content/schemas.mjs reject either, the next deploy
// fails as soon as someone saves in the admin. The entries below have exactly
// that shape; the test builds the site with them.
const savedByCms = {
  'src/content/blog/cms-saved-post.md': `---
title: "Launch Day: Our New Site!"
description: Created in the CMS.
pubDate: 2026-11-10
updatedDate: ""
author: AMS Builds Team
featured: false
noindex: false
draft: false
---
Body typed in the editor.
`,
  'src/content/projects/cms-saved-project.md': `---
title: Clinic Booking Portal
description: Booking site for a clinic.
client: ""
category: web
coverImage: ""
featured: false
date: 2026-11-10
liveUrl: ""
noindex: false
draft: false
---
Case study body.
`,
  'src/content/pages/cms-saved-page.md': `---
title: Pricing
noindex: false
navOrder: ""
showInNav: true
showInFooter: false
draft: false
updatedDate: 2026-11-10
---
Our pricing.
`,
};

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const notCopied = new Set(['node_modules', 'dist', '.git', '.astro']);

test('entries saved by the CMS build, and their dates come out right', { timeout: 300_000 }, async (t) => {
  // Build a private copy of the site so the real src/content and dist/ are never touched.
  const site = await mkdtemp(join(tmpdir(), 'ams-cms-content-'));
  t.after(() => rm(site, { recursive: true, force: true }));
  await cp(root, site, {
    recursive: true,
    filter: (source) => !notCopied.has(relative(root, source).split(sep)[0]),
  });
  await symlink(join(root, 'node_modules'), join(site, 'node_modules'), 'junction');
  for (const [file, text] of Object.entries(savedByCms)) await writeFile(join(site, file), text);

  try {
    await run(process.execPath, [join(root, 'node_modules', 'astro', 'astro.js'), 'build'], {
      cwd: site,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', CMS_EXPORT_URL: 'http://127.0.0.1:1/offline' },
    });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    const reason = output.split('\n').filter((line) => /error|does not match|expected|required|invalid/i.test(line)).slice(0, 8).join('\n');
    assert.fail(`"astro build" failed for content saved by the CMS:\n${reason || output.slice(-1500)}`);
  }

  const built = (path) => readFile(join(site, 'dist', path), 'utf8');

  const post = await built('blog/cms-saved-post/index.html');
  assert.match(post, /<time datetime="2026-11-10">/);
  assert.match(post, /property="article:published_time" content="2026-11-10"/);
  assert.doesNotMatch(post, /article:modified_time/, 'an emptied "Updated Date" is treated as not set');

  const project = await built('projects/cms-saved-project/index.html');
  assert.match(project, />2026-11-10</);

  const page = await built('cms-saved-page/index.html');
  assert.match(page, /Our pricing\./);

  const feed = await built('rss.xml');
  assert.match(feed, /<pubDate>Tue, 10 Nov 2026 00:00:00 GMT<\/pubDate>/);

  for (const [name, html] of Object.entries({ post, project, page, feed })) {
    assert.doesNotMatch(html, /Invalid Date/, `${name} shows "Invalid Date"`);
  }
});
