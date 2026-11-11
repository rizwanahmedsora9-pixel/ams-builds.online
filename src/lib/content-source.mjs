// Build-time content source: reads src/content/ files and validates them
// with the zod schemas in src/content/schemas.mjs.
import { blogSchema, pageSchema, projectSchema, settingsSchema } from '../content/schemas.mjs';
import { fileEntries, fileSettings } from './content-files.mjs';

const schemas = { blog: blogSchema, pages: pageSchema, projects: projectSchema };

let buildCache = null;

function build() {
  const entries = fileEntries().map((entry) => ({
    ...entry,
    data: entry.data ? { ...entry.data } : {},
  }));
  const settings = { ...fileSettings() };

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
