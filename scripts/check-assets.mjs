#!/usr/bin/env node
/**
 * Panel asset budgets and design-token guard.
 *
 * Phase 0 of the overhaul moved the admin CSS out of a TypeScript string and
 * into three cacheable files. This script keeps them honest:
 *
 *   - no colour literals in app.css or screens/*.css (tokens.css owns colour)
 *   - size budgets per bundle, so the panel cannot quietly bloat
 *   - every screen class the routes use is either defined or a known exception
 *
 * Run with `npm run check:assets` (also part of `npm test`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'src/admin/assets');

const limits = {
  'tokens.css': { raw: 12 * 1024, gzip: 4 * 1024 },
  'app.css': { raw: 36 * 1024, gzip: 10 * 1024 },
  'screens/dashboard.css': { raw: 10 * 1024, gzip: 3 * 1024 },
  'screens/lists.css': { raw: 12 * 1024, gzip: 4 * 1024 },
  'screens/editor.css': { raw: 12 * 1024, gzip: 4 * 1024 },
  'screens/appearance.css': { raw: 10 * 1024, gzip: 3 * 1024 },
  'screens/themes.css': { raw: 6 * 1024, gzip: 2 * 1024 },
  'screens/legacy.css': { raw: 24 * 1024, gzip: 7 * 1024 },
};

const failures = [];
const notes = [];

const read = (rel) => readFileSync(join(ASSETS, rel), 'utf8');

/** Colour literals: #rrggbb, rgb(), hsl(), or a named colour outside tokens. */
const COLOUR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi;

for (const [rel, budget] of Object.entries(limits)) {
  const css = read(rel);
  const gzip = gzipSync(Buffer.from(css), { level: 9 }).length;
  const raw = Buffer.byteLength(css);
  notes.push(`${rel.padEnd(20)} ${(raw / 1024).toFixed(1)} KB raw · ${(gzip / 1024).toFixed(1)} KB gzip`);
  if (raw > budget.raw) failures.push(`${rel} is ${(raw / 1024).toFixed(1)} KB, over the ${(budget.raw / 1024).toFixed(0)} KB budget`);
  if (gzip > budget.gzip) failures.push(`${rel} gzips to ${(gzip / 1024).toFixed(1)} KB, over the ${(budget.gzip / 1024).toFixed(0)} KB budget`);

  if (rel === 'tokens.css') continue; // the token layer is where colours are allowed
  const matches = [...css.matchAll(COLOUR)].map((m) => m[0]);
  if (matches.length) {
    failures.push(`${rel} hard-codes ${matches.length} colour(s) (${[...new Set(matches)].slice(0, 6).join(', ')}); add a token to tokens.css instead`);
  }
}

// tokens.css must define every alias the components reference.
const tokens = read('tokens.css');
const defined = new Set([...tokens.matchAll(/^\s*(--[a-z0-9-]+):/gim)].map((m) => m[1]));
const used = new Set();
for (const rel of Object.keys(limits).filter((r) => r !== 'tokens.css')) {
  for (const m of read(rel).matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
}
const missing = [...used].filter((name) => !defined.has(name));
if (missing.length) failures.push(`undefined token(s): ${missing.join(', ')}`);

/* The writer's editor ships one more stylesheet: the classic/modern chrome, as
   a single <style> in src/routes/admin/content.ts. It is not one of the three
   cacheable files, but it is panel CSS all the same and has to play by the same
   rules. The check matters more here than in the files: a `var(--card)` that
   does not exist does not fail anything, it silently drops the whole
   declaration and the toolbar buttons lose their background. */
const editorSource = readFileSync(join(ROOT, 'src/routes/admin/content.ts'), 'utf8');
const inline = editorSource.match(/export const EDITOR_CSS = `<style>([\s\S]*?)<\/style>`;/);
if (!inline) {
  failures.push('EDITOR_CSS is no longer one <style> block in content.ts; update this check');
} else {
  const editorCss = inline[1];
  notes.push(`editor <style>       ${(Buffer.byteLength(editorCss) / 1024).toFixed(1)} KB inline (content.ts)`);
  for (const m of editorCss.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
  const editorMissing = [...new Set([...editorCss.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))].filter((name) => !defined.has(name));
  if (editorMissing.length) failures.push(`editor CSS references undefined token(s): ${editorMissing.join(', ')}`);
  const editorColours = [...editorCss.matchAll(COLOUR)].map((m) => m[0]);
  if (editorColours.length) {
    failures.push(`editor CSS hard-codes ${editorColours.length} colour(s) (${[...new Set(editorColours)].slice(0, 6).join(', ')}); add a token to tokens.css instead`);
  }
}

// Every screen family present on disk is imported, so nothing silently ships dead.
const screensDir = join(ASSETS, 'screens');
const screens = readdirSync(screensDir).filter((f) => f.endsWith('.css'));
const bundleSource = readFileSync(join(ROOT, 'src/admin/bundles.ts'), 'utf8');
for (const file of screens) {
  if (!bundleSource.includes(`assets/screens/${file}`)) failures.push(`screens/${file} is not imported by src/admin/bundles.ts`);
}

// Report, then fail loudly.
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log('Panel assets:');
for (const note of notes) console.log(`  ${note}`);
console.log(`  ${defined.size} design tokens defined, ${used.size} referenced`);
if (failures.length) {
  console.error('\nAsset check failed:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`\nAll budgets met (largest bundle ${kb(Math.max(...Object.keys(limits).map((r) => Buffer.byteLength(read(r)))))}).`);
