// Frontmatter + data-file YAML, matching how Astro's content collections read
// files: `---` blocks in .md, plain YAML in settings/site.yml, unquoted
// YYYY-MM-DD dates parsed as Date and normalised back to 'YYYY-MM-DD'.
import { dump, load } from 'js-yaml';

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Recursively turn Date instances into 'YYYY-MM-DD' strings. */
export function normalizeYamlValues(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map(normalizeYamlValues);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeYamlValues(v);
    return out;
  }
  return value;
}

/** Parse a Markdown file with a `---` frontmatter block. */
export function parseFrontmatter(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '');
  const match = text.match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: text };
  let data = {};
  try {
    data = load(match[1]) ?? {};
  } catch {
    data = {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  return { data, body: text.slice(match[0].length) };
}

/** Parse a plain YAML data file (settings/site.yml). */
export function parseDataFile(raw) {
  try {
    const data = load(String(raw ?? ''));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
    /* fall through */
  }
  return {};
}

/** Serialise {frontmatter, body} back into a Markdown file. */
export function serializeFrontmatter(data, body) {
  const normalised = normalizeYamlValues(data && typeof data === 'object' ? data : {});
  const yamlText = dump(normalised, {
    lineWidth: 100000,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
  return `---\n${yamlText}---\n${String(body ?? '')}`;
}

/** Serialise settings data back into settings/site.yml. */
export function serializeDataFile(data) {
  const normalised = normalizeYamlValues(data && typeof data === 'object' ? data : {});
  return dump(normalised, {
    lineWidth: 100000,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}
