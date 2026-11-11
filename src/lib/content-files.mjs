// Reads the git-tracked content files (src/content) into plain entries.
// Safe to import anywhere — build, astro dev and the admin Worker bundle
// (it only depends on Vite globs + YAML parsing, never on astro:content).
import { parseDataFile, parseFrontmatter } from './yaml.mjs';
import { mergeEntries, mergeSettings } from './merge.mjs';

export { mergeEntries, mergeSettings };

const mdFiles = import.meta.glob('/src/content/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const dataFiles = import.meta.glob('/src/content/**/*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const ENTRY_PATH_RE = /\/src\/content\/(blog|pages|projects)\/([^/]+)\.md$/;

/** All file-backed entries: [{ slug, type, data, body }], sorted by slug. */
export function fileEntries() {
  const entries = [];
  for (const [path, raw] of Object.entries(mdFiles)) {
    const match = path.match(ENTRY_PATH_RE);
    if (!match) continue;
    const { data, body } = parseFrontmatter(raw);
    entries.push({ slug: match[2], type: match[1], data, body });
  }
  entries.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return entries;
}

/** settings/site.yml contents ({} when missing). */
export function fileSettings() {
  const raw = dataFiles['/src/content/settings/site.yml'];
  return raw ? parseDataFile(raw) : {};
}
