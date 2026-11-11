import type { Env } from '../types';
import { slugify } from './security';
import { isZip, unzip } from './zip';
import { TEMPLATE_NAMES, defaultTheme, type ThemeBundle } from '../themes/default';

export const MAX_THEME_UPLOAD = 2 * 1024 * 1024;
const MAX_BUNDLE = 1024 * 1024; // stored size (one D1 row)

/** Thrown for problems the uploader should read; anything else is a bug. */
export class ThemeError extends Error {}

/**
 * Checks and normalises a theme bundle:
 *   { "name": "...", "version": "1.0.0", "templates": { "base": "<html>...", ... }, "css": "..." }
 * Only "base" is required; missing templates fall back to the Default theme's.
 */
export function validateBundle(input: unknown): ThemeBundle {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ThemeError('theme.json must be a JSON object.');
  const o = input as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
  if (!name) throw new ThemeError('The theme needs a "name".');
  const slug = slugify(typeof o.slug === 'string' && o.slug ? o.slug : name);
  if (!slug) throw new ThemeError('The theme name must contain letters or digits.');
  const version = typeof o.version === 'string' && o.version.trim() ? o.version.trim().slice(0, 20) : '1.0.0';
  if (!o.templates || typeof o.templates !== 'object') throw new ThemeError('The theme needs a "templates" object.');
  const templates: Record<string, string> = {};
  for (const key of TEMPLATE_NAMES) {
    const value = (o.templates as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new ThemeError(`Template "${key}" must be text.`);
    templates[key] = value;
  }
  if (!templates.base) throw new ThemeError('The theme needs a "base" template.');
  if (!/\{\{\{\s*content\s*\}\}\}/.test(templates.base)) throw new ThemeError('The "base" template must contain {{{content}}} where the page goes.');
  const css = typeof o.css === 'string' ? o.css : '';
  if (JSON.stringify(templates).length + css.length > MAX_BUNDLE) throw new ThemeError('The theme is too large (limit 1 MB of templates and CSS).');
  return { name, slug, version, templates, css };
}

/**
 * Reads an uploaded theme: either a .json bundle, or a .zip holding theme.json
 * plus the files it names (same layout as src/themes/default/).
 */
export async function readThemeUpload(buf: ArrayBuffer): Promise<ThemeBundle> {
  if (buf.byteLength > MAX_THEME_UPLOAD) throw new ThemeError('The file is too large (limit 2 MB).');
  const decoder = new TextDecoder();
  const parse = (text: string): Record<string, unknown> => {
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new ThemeError('theme.json is not valid JSON.');
    }
  };
  if (!isZip(buf)) return validateBundle(parse(decoder.decode(buf)));

  let files: Map<string, Uint8Array>;
  try {
    files = await unzip(buf, { maxEntries: 60, maxTotalBytes: 3 * 1024 * 1024 });
  } catch (err) {
    throw new ThemeError(err instanceof Error ? err.message : 'Could not read the zip file.');
  }
  // theme.json may sit at the top level or inside one folder.
  const manifestPath = [...files.keys()].filter((p) => p === 'theme.json' || p.endsWith('/theme.json')).sort((a, b) => a.length - b.length)[0];
  if (!manifestPath) throw new ThemeError('The zip file does not contain a theme.json.');
  const dir = manifestPath.slice(0, -'theme.json'.length);
  const manifest = parse(decoder.decode(files.get(manifestPath)!));
  const file = (ref: unknown): string | undefined => {
    if (typeof ref !== 'string') return undefined;
    const data = files.get(dir + ref.replace(/^\.?\//, ''));
    return data ? decoder.decode(data) : undefined;
  };
  const declared = (manifest.templates && typeof manifest.templates === 'object' ? manifest.templates : {}) as Record<string, unknown>;
  const templates: Record<string, unknown> = {};
  for (const key of TEMPLATE_NAMES) {
    const ref = declared[key];
    if (ref === undefined) {
      const auto = file(`${key}.html`); // convention: base.html, home.html, ...
      if (auto !== undefined) templates[key] = auto;
    } else if (typeof ref === 'string' && /^[\w./-]+\.html?$/i.test(ref)) {
      const text = file(ref);
      if (text === undefined) throw new ThemeError(`theme.json names "${ref}" but that file is not in the zip.`);
      templates[key] = text;
    } else {
      templates[key] = ref; // template written inline
    }
  }
  let css: unknown = manifest.css;
  if (typeof css === 'string' && /^[\w./-]+\.css$/i.test(css)) {
    css = file(css);
    if (css === undefined) throw new ThemeError(`theme.json names "${manifest.css}" but that file is not in the zip.`);
  } else if (css === undefined) {
    css = file('style.css') ?? '';
  }
  return validateBundle({ ...manifest, templates, css });
}

/** Inserts the theme, or updates the one with the same slug (keeping whether it is active). */
export async function saveTheme(env: Env, t: ThemeBundle): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO themes (slug,name,version,templates,css,active,created_at) VALUES (?,?,?,?,?,0,?)
     ON CONFLICT(slug) DO UPDATE SET name=excluded.name, version=excluded.version, templates=excluded.templates, css=excluded.css`,
  ).bind(t.slug, t.name, t.version, JSON.stringify(t.templates), t.css, new Date().toISOString()).run();
}

export const restoreDefaultTheme = (env: Env): Promise<void> => saveTheme(env, defaultTheme);
