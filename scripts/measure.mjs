#!/usr/bin/env node
/**
 * Measures the performance budgets against the built server.
 *
 * Budgets are only real if something enforces them, and the numbers have to
 * come from the built output rather than from a source file: what a browser
 * downloads is `dist/server.mjs`. This script boots it on a temporary data
 * directory, installs a site, and gzips what comes back.
 *
 *   npm run check:budgets          # human-readable, exit 1 when over budget
 *   npm run check:budgets -- --json
 *
 * Run by `npm test`; also shown in the panel (Tools -> Site Health) so the
 * limits are visible where the site is looked after.
 */
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from '../tests/helpers.mjs';

const BUDGETS = {
  public_page: { label: 'Public page, gzipped', bytes: 45 * 1024 },
  admin_html: { label: 'Panel page HTML, gzipped', bytes: 60 * 1024 },
  admin_css: { label: 'Panel CSS, all three files, gzipped', bytes: 25 * 1024 },
  editor_js: { label: 'Panel + editor JavaScript, gzipped', bytes: 30 * 1024 },
};

const gz = (text) => gzipSync(Buffer.from(text), { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const harness = createHarness();
const rows = [];

try {
  await harness.start();
  const { admin } = await harness.install();

  // The public site: home, a post page and the archive. The heaviest wins.
  await harness.adminPost('/posts/new', {
    title: 'A post long enough to render', slug: 'budget-post', body: '<p>' + 'Lorem ipsum dolor sit amet. '.repeat(120) + '</p>',
    excerpt: 'Measuring a page.', status: 'published',
  });
  const publicPages = await Promise.all(['/', '/blog', '/budget-post'].map((p) => harness.get(p)));
  rows.push({ key: 'public_page', size: Math.max(...publicPages.map((p) => gz(p.text))) });

  // The panel: the editor is the heaviest document, the dashboard second.
  const panelPages = await Promise.all([`${admin}/posts/new`, `${admin}/`, `${admin}/themes`, `${admin}/appearance`].map((p) => harness.get(p)));
  for (const page of panelPages) if (page.status !== 200) throw new Error('a panel page did not render');
  rows.push({ key: 'admin_html', size: Math.max(...panelPages.map((p) => gz(p.text))) });

  // The panel's stylesheets, concatenated as a browser downloads them.
  const css = await Promise.all(['tokens', 'app', 'screens'].map(async (name) => (await harness.get(`${admin}/assets/${name}.css`)).text));
  rows.push({ key: 'admin_css', size: gz(css.join('')) });

  // Every script the panel ships: the shell, the palette and the editor.
  const editor = panelPages[0].text;
  const inline = [...editor.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  rows.push({ key: 'editor_js', size: gz(inline) });
} finally {
  await harness.stop();
  harness.cleanup();
}

// The panel shows these numbers (Tools -> Site Health), so write them next to
// the budget definitions the panel reads. A stale file is impossible in
// practice: the check fails before the report can be committed as passing.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const measured = Object.fromEntries(rows.map((r) => [r.key, r.size]));
  writeFileSync(join(ROOT, 'src/lib/budget-report.json'), JSON.stringify(measured, null, 2) + '\n');
} catch (err) {
  console.warn('could not write the budget report:', err.message);
}

const json = process.argv.includes('--json');
const results = rows.map((row) => {
  const budget = BUDGETS[row.key];
  return { key: row.key, label: budget.label, actual: row.size, budget: budget.bytes, ok: row.size <= budget.bytes };
});

if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log('Performance budgets (gzipped, without media):');
  for (const r of results) {
    const pct = Math.round((r.actual / r.budget) * 100);
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(42)} ${kb(r.actual).padStart(9)} of ${kb(r.budget)} (${pct}%)`);
  }
}

const over = results.filter((r) => !r.ok);
if (over.length) {
  console.error(`\n${over.length} budget${over.length === 1 ? '' : 's'} exceeded: ${over.map((r) => r.key).join(', ')}`);
  process.exit(1);
}
if (!json) console.log('\nAll performance budgets met.');
