import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

// Decap CMS validates public/admin/config.yml in the browser and refuses to start
// ("Error loading the CMS configuration") if it breaks any of the rules below, so a mistake
// here takes the whole /admin/ page down. These tests apply the same rules before deploy.

const inRepo = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const config = yaml.load(readFileSync(inRepo('public/admin/config.yml'), 'utf8'));
const collections = config.collections ?? [];

const duplicates = (names) => names.filter((name, index) => names.indexOf(name) !== index);

// Every field needs a name, names must be unique within their list, and a list of fields
// may not be empty. Applies to nested fields (e.g. the rows of the "stats" list) as well.
function fieldProblems(fields, where) {
  if (!Array.isArray(fields) || fields.length === 0) return [`${where}: "fields" must be a non-empty list`];
  const problems = [];
  const names = fields.map((field) => field?.name);
  if (names.some((name) => !name)) problems.push(`${where}: every field needs a "name"`);
  for (const name of new Set(duplicates(names))) problems.push(`${where}: field name "${name}" is used more than once`);
  for (const field of fields) {
    if (field && 'fields' in field) problems.push(...fieldProblems(field.fields, `${where} → ${field.name}`));
  }
  return problems;
}

// A collection is EITHER a folder of entries (`folder` + `fields`) OR a list of fixed files
// (`files:`, each with name, label, file and fields). A single file is still a `files:` list
// with one entry — `file:` directly on the collection is not valid.
function collectionProblems(collection, index) {
  const where = `collections[${index}] "${collection?.name ?? '?'}"`;
  const problems = [];
  for (const key of ['name', 'label']) {
    if (!collection?.[key]) problems.push(`${where}: missing "${key}"`);
  }

  const hasFiles = Array.isArray(collection.files);
  const hasFolder = typeof collection.folder === 'string' && 'fields' in collection;
  if (hasFiles === hasFolder) {
    const hint = 'file' in collection ? ' (found a bare "file:" — move it into a "files:" list)' : '';
    problems.push(`${where}: needs exactly one of "files" or "folder" + "fields"${hint}`);
    return problems;
  }

  if (hasFolder) {
    if (!existsSync(inRepo(collection.folder))) problems.push(`${where}: folder "${collection.folder}" does not exist`);
    problems.push(...fieldProblems(collection.fields, where));
    return problems;
  }

  if (collection.files.length === 0) problems.push(`${where}: "files" must list at least one file`);
  for (const name of new Set(duplicates(collection.files.map((entry) => entry?.name)))) {
    problems.push(`${where}: file name "${name}" is used more than once`);
  }
  collection.files.forEach((entry, entryIndex) => {
    const entryWhere = `${where} → files[${entryIndex}] "${entry?.name ?? '?'}"`;
    for (const key of ['name', 'label', 'file']) {
      if (!entry?.[key]) problems.push(`${entryWhere}: missing "${key}"`);
    }
    if (entry?.file && !existsSync(inRepo(entry.file))) problems.push(`${entryWhere}: file "${entry.file}" does not exist`);
    problems.push(...fieldProblems(entry?.fields, entryWhere));
  });
  return problems;
}

test('CMS config has the top-level settings Decap requires', () => {
  assert.ok(config.backend?.name, 'backend.name is required');
  assert.ok(config.media_folder || config.media_library, 'media_folder (or media_library) is required');
  assert.ok(collections.length > 0, 'at least one collection is required');
});

test('every CMS collection has a shape Decap accepts', () => {
  const problems = collections.flatMap(collectionProblems);
  assert.deepEqual(problems, []);
});

test('CMS collection names are unique', () => {
  assert.deepEqual(duplicates(collections.map((collection) => collection.name)), []);
});

test('Site Settings edits src/content/settings/site.yml and covers every setting stored in it', () => {
  const settings = collections.find((collection) => collection.name === 'settings');
  assert.ok(settings, 'a "settings" collection exists');
  const entry = settings.files?.find((file) => file.file === 'src/content/settings/site.yml');
  assert.ok(entry, 'the settings collection lists src/content/settings/site.yml under "files:"');

  // Astro reads this file as the entry "site" of the "settings" collection (see src/utils/site.ts).
  const stored = yaml.load(readFileSync(inRepo(entry.file), 'utf8'));
  const editable = new Set(entry.fields.map((field) => field.name));
  const notEditable = Object.keys(stored).filter((key) => !editable.has(key));
  assert.deepEqual(notEditable, [], 'settings in site.yml that have no field in the CMS');
});
