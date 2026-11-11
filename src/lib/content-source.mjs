// Build-time content source: git files + CMS overrides (from the dev store in
// `astro dev`, from the public export endpoint during `astro build`), validated
// with the same zod schemas the collections use. Draft entries are excluded
// from validation — the build only needs their existence to keep them unrouted.
import { blogSchema, pageSchema, projectSchema, settingsSchema } from '../content/schemas.mjs';
import { fileEntries, fileSettings } from './content-files.mjs';
import { mergeEntries, mergeSettings } from './merge.mjs';
import { exportUrl } from './publish.mjs';

const schemas = { blog: blogSchema, pages: pageSchema, projects: projectSchema };

let buildCache = null;
let overridesCache; // promise, build mode only

async function fetchOverrides() {
  if (import.meta.env.DEV) {
    const { createDevStore } = await import('./dev-store.mjs');
    return createDevStore().exportAll();
  }
  if (!overridesCache) {
    overridesCache = (async () => {
      try {
        const response = await fetch(exportUrl(import.meta.env.SITE), {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return null;
        const payload = await response.json();
        if (!payload || !Array.isArray(payload.entries)) return null;
        return payload;
      } catch {
        return null; // offline / first deploy → git files only
      }
    })();
  }
  return overridesCache;
}

async function build() {
  const overrides = await fetchOverrides();
  const entries = mergeEntries(fileEntries(), overrides?.entries ?? []);
  const settings = mergeSettings(fileSettings(), overrides?.settings);

  for (const entry of entries) {
    if (entry.data?.draft === true) continue; // never routed; metadata may be partial
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

  const settingsResult = settingsSchema.safeParse(settings);
  if (!settingsResult.success) {
    const issues = settingsResult.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid site settings: ${issues}`);
  }

  return { entries, settings: settingsResult.data };
}

/** All content entries (every type), validated. */
export async function loadContent() {
  if (import.meta.env.DEV) return build(); // fresh read so dev edits show up live
  buildCache ??= build();
  return buildCache;
}

/** Entries of one collection — drop-in for getCollection(type, filter). */
export async function contentCollection(type, filter) {
  const { entries } = await loadContent();
  const list = entries.filter((entry) => entry.type === type);
  return typeof filter === 'function' ? list.filter((entry) => filter({ data: entry.data })) : list;
}

/** Site settings entry — drop-in for getEntry('settings', 'site'). */
export async function getSettingsEntry() {
  const { settings } = await loadContent();
  return { data: settings };
}
