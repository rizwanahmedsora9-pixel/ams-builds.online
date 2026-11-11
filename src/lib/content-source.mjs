// Shared content source for public pages. Git Markdown/YAML is the baseline;
// saved CMS entries override it in the Durable Object (or .dev-cms locally).
// Runtime requests always read the current store and cache only within that
// request, so an admin save is visible on the very next page load everywhere.
//
// A fresh/empty deployment (no src/content/*.md files and no CMS store yet)
// builds cleanly: entries is an empty array and settings uses schema defaults.
// The public site renders with empty lists and fallback site settings — the
// admin panel is the setup tool, exactly like a WordPress install.
import { blogSchema, pageSchema, projectSchema, settingsSchema } from '../content/schemas.mjs';
import { fileEntries, fileSettings } from './content-files.mjs';
import { mergeEntries, mergeSettings } from './merge.mjs';

const schemas = { blog: blogSchema, pages: pageSchema, projects: projectSchema };
let buildCache = null;

async function fetchOverrides(locals) {
  if (import.meta.env.DEV) {
    const { createDevStore } = await import('./dev-store.mjs');
    return createDevStore().exportAll();
  }
  if (locals?.runtime?.env?.CMS) {
    const { getStore } = await import('./store.mjs');
    const store = await getStore(locals);
    return store.exportAll();
  }
  // Prerendered fallbacks (404) use repository content. Public CMS routes are
  // dynamic and take the branch above at request time.
  return null;
}

function validateEntries(entries) {
  // Only validate when there are entries to validate (empty CMS / empty
  // content directory is a valid state — fresh install).
  if (!entries || entries.length === 0) return;
  for (const entry of entries) {
    if (entry.data?.draft === true) continue;
    const schema = schemas[entry.type];
    if (!schema) continue;
    const result = schema.safeParse(entry.data);
    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid ${entry.type} entry "${entry.slug}": ${issues}`);
    }
    entry.data = result.data;
  }
}

function validateSettings(settings) {
  // Settings always parse with defaults (schema fields are optional).
  // Only flag genuinely malformed non-empty settings objects.
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return {};
  }
  const result = settingsSchema.safeParse(settings);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid site settings: ${issues}`);
  }
  return result.data;
}

async function build(locals) {
  const overrides = await fetchOverrides(locals);
  const entries = mergeEntries(fileEntries(), overrides?.entries ?? []);
  const settings = mergeSettings(fileSettings(), overrides?.settings);

  validateEntries(entries);
  const settingsData = validateSettings(settings);

  return { entries, settings: settingsData };
}

/** Load current content, with at most one store read per HTTP request. */
export async function loadContent(locals = null) {
  if (locals && typeof locals === 'object') {
    locals.__amsCmsContent ??= build(locals);
    return locals.__amsCmsContent;
  }
  if (import.meta.env.DEV) return build(locals);
  buildCache ??= build(null);
  return buildCache;
}

/** Entries of one collection — drop-in for getCollection(type, filter). */
export async function contentCollection(type, filter, locals = null) {
  const { entries } = await loadContent(locals);
  const list = entries.filter((entry) => entry.type === type);
  return typeof filter === 'function' ? list.filter((entry) => filter({ data: entry.data })) : list;
}

/** Site settings entry — drop-in for getEntry('settings', 'site'). */
export async function getSettingsEntry(locals = null) {
  const { settings } = await loadContent(locals);
  return { data: settings };
}
