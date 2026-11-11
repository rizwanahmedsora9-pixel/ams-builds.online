import { fileEntries, fileSettings } from '../lib/content-files.mjs';
import { repoImages } from '../lib/media-files.mjs';
import { normalizeYamlValues } from '../lib/yaml.mjs';

export const prerender = true;

export function buildBaselineData() {
  const entries = fileEntries().map((entry) => ({
    slug: entry.slug,
    type: entry.type,
    data: normalizeYamlValues(entry.data || {}),
    body: entry.body || '',
  }));
  const settings = normalizeYamlValues(fileSettings() || {});
  const media = repoImages();
  return { entries, settings, media };
}

export function GET() {
  return new Response(JSON.stringify(buildBaselineData()), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
