/**
 * Theme platform v2.
 *
 * A theme is: a manifest (`theme.json` v2), a set of templates, partials, a
 * stylesheet and optional binary assets (logos, fonts, a per-theme script).
 * This module owns the *shape* of a theme: validating a manifest, reading an
 * uploaded zip, and answering what a theme inherits from its parent.
 *
 * Storage lives elsewhere on purpose:
 *   - templates/partials/manifest -> the `themes` row (src/lib/themes.ts)
 *   - binary assets               -> the file store, keyed `themes/{slug}/{path}`
 *     (src/lib/theme-assets.ts), served by `GET /theme-assets/{slug}/{path}`
 */
import { safeUrl, slugify } from './security';
import { APP_VERSION } from './version';

export const MAX_THEME_UPLOAD = 6 * 1024 * 1024; // the zip itself
export const MAX_THEME_ASSET = 512 * 1024; // one asset file
export const MAX_THEME_ASSETS_TOTAL = 4 * 1024 * 1024; // all assets of one theme, uncompressed
export const MAX_ASSETS_PER_THEME = 80;

/** Assets a theme may ship. Anything not listed is rejected before it is stored. */
const ASSET_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  js: 'text/javascript; charset=utf-8',
};

/**
 * Refused on purpose: SVG (it can carry script and would then be served from
 * this origin), web fonts in the legacy EOT format (dead), and anything
 * document-shaped (HTML, PDF). A theme that needs an icon uses a PNG or an
 * inline glyph from its template.
 */
export const REFUSED_ASSET_TYPES = ['svg', 'html', 'htm', 'pdf', 'zip', 'xml'];

export function assetMime(path: string): string | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ASSET_TYPES[ext] ?? null;
}

export const isRefusedAsset = (path: string): boolean => {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return REFUSED_ASSET_TYPES.includes(ext);
};

/** Normalises an asset path: forward slashes, no `..`, no leading slash, lower case. */
export function cleanAssetPath(input: string): string {
  const cleaned = input
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/\/{2,}/g, '/');
  if (!cleaned || cleaned.includes('..') || cleaned.startsWith('/')) return '';
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(cleaned)) return '';
  if (cleaned.split('/').length > 4 || cleaned.length > 120) return '';
  return cleaned;
}

/* ---------------------------------------------------------------- manifest */

export type ThemeSettingType = 'text' | 'textarea' | 'toggle' | 'color' | 'select' | 'number' | 'range' | 'image' | 'url';

export type ThemeSetting = {
  key: string;
  type: ThemeSettingType;
  label: string;
  default: string | number | boolean;
  help?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
};

export type ThemeManifest = {
  name: string;
  slug: string;
  version: string;
  author: string;
  authorUrl: string;
  homepage: string;
  description: string;
  /** Slug of the theme this one inherits templates, partials and assets from. */
  parent: string | null;
  /** Template name that holds `{{#block content}}` when a template omits its own wrap. */
  layout: string;
  tags: string[];
  supports: string[];
  screenshot: string;
  /** Colour preview [background, text, accent], used by the store. */
  preview: string[];
  settings: ThemeSetting[];
  /**
   * Named widget areas a theme renders with `{{{widgets "footer"}}}`. A theme
   * that declares none gets the classic footer slots, so no existing theme
   * changes behaviour.
   */
  widgets: ThemeWidgetArea[];
  changelog: { version: string; notes: string }[];
  assets: string[];
  /** Versioned developer package metadata. Optional on legacy v1/v2 manifests. */
  cms_compatibility: { min: string; max?: string };
  required_templates: string[];
  optional_templates: string[];
  features: string[];
  menu_locations: string[];
  /** Canonical v3 name; `settings` remains as the renderer's compatible alias. */
  settings_schema: ThemeSetting[];
  asset_entrypoints: { css: string; js: string[] };
  /** What the theme asked for; legacy v1/v2 manifests are upgraded on load. */
  manifest_version: 2 | 3;
  /** Assets found in the archive itself (kept apart from `assets`, which is the manifest's list). */
  shipped?: string[];
};

/** A theme as the renderer needs it. */
export type ThemeBundle = {
  name: string;
  slug: string;
  version: string;
  templates: Record<string, string>;
  partials: Record<string, string>;
  css: string;
  manifest: ThemeManifest;
};

export class ThemeError extends Error {}

export const TEMPLATE_NAMES = ['base', 'home', 'page', 'post', 'archive', '404'] as const;
/** Templates a theme may declare beyond the standard set (`page-landing`, `search`, …). */
const EXTRA_TEMPLATE = /^[a-z][a-z0-9-]{1,30}$/;

/** A place a theme puts widgets: the panel renders one editor per area. */
export type ThemeWidgetArea = { key: string; label: string; help?: string };

/**
 * What a theme without a `widgets` declaration offers: one footer area with
 * three slots. The key is `footer` on purpose — the slots are stored as
 * `widget_footer_1_body`, exactly the keys every site installed before this
 * release already has, so old widgets keep rendering.
 */
export const DEFAULT_WIDGET_AREAS: ThemeWidgetArea[] = [
  { key: 'footer', label: 'Footer', help: 'Three columns after the theme footer.' },
];

/** Storage key for one widget: `widget_<area>_<slot>_<field>`. */
export const widgetKey = (area: string, slot: number, field: 'title' | 'body'): string =>
  `widget_${area.replace(/-/g, '_')}_${slot}_${field}`;

const SETTING_TYPES: ThemeSettingType[] = ['text', 'textarea', 'toggle', 'color', 'select', 'number', 'range', 'image', 'url'];
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Widget areas. `"widgets": ["footer", "sidebar"]` is the short form; the long
 * form gives each area a label and a hint. Keys become part of a settings key,
 * so they are restricted to `[a-z0-9-]`.
 */
function parseWidgetAreas(input: unknown): ThemeWidgetArea[] {
  if (input === undefined) return DEFAULT_WIDGET_AREAS;
  if (!Array.isArray(input)) throw new ThemeError('"widgets" must be a list of area names.');
  if (input.length > 8) throw new ThemeError('A theme may declare at most 8 widget areas.');
  const seen = new Set<string>();
  return input.map((raw, i) => {
    const o = (typeof raw === 'string' ? { key: raw } : raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') throw new ThemeError(`Widget area ${i + 1} must be a name or an object.`);
    const key = str(o.key, 24).toLowerCase();
    if (!/^[a-z][a-z0-9-]{0,22}$/.test(key)) throw new ThemeError(`Widget area ${i + 1} needs a key like "footer" or "sidebar-left".`);
    if (seen.has(key)) throw new ThemeError(`The widget area "${key}" is declared twice.`);
    seen.add(key);
    return { key, label: str(o.label, 40) || key.replace(/-/g, ' '), ...(str(o.help, 120) ? { help: str(o.help, 120) } : {}) };
  });
}

function parseSettings(input: unknown): ThemeSetting[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new ThemeError('"settings" must be a list.');
  if (input.length > 40) throw new ThemeError('A theme may declare at most 40 settings.');
  const seen = new Set<string>();
  return input.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new ThemeError(`Setting ${i + 1} must be an object.`);
    const o = raw as Record<string, unknown>;
    const key = str(o.key, 60);
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) throw new ThemeError(`Setting ${i + 1} needs a "key" like "hero_title".`);
    if (seen.has(key)) throw new ThemeError(`The setting "${key}" is declared twice.`);
    seen.add(key);
    const type = str(o.type, 20) as ThemeSettingType || 'text';
    if (!SETTING_TYPES.includes(type)) throw new ThemeError(`Setting "${key}" has an unknown type "${type}".`);
    const label = str(o.label, 80) || key.replace(/_/g, ' ');
    let def: string | number | boolean = '';
    let min: number | undefined;
    let max: number | undefined;
    let step: number | undefined;
    if (type === 'toggle') def = o.default === true || o.default === '1' || o.default === 'true';
    else if (type === 'number' || type === 'range') {
      min = o.min === undefined ? undefined : Number(o.min);
      max = o.max === undefined ? undefined : Number(o.max);
      step = o.step === undefined ? undefined : Number(o.step);
      if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max))
        || (step !== undefined && (!Number.isFinite(step) || step <= 0)) || (min !== undefined && max !== undefined && min > max)) {
        throw new ThemeError(`Setting "${key}" has invalid numeric limits.`);
      }
      if (type === 'range' && (min === undefined || max === undefined)) throw new ThemeError(`Range setting "${key}" needs min and max values.`);
      const n = Number(o.default);
      def = Number.isFinite(n) ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)) : (min ?? 0);
    } else def = str(o.default, 400);
    if (type === 'color' && def && !COLOR.test(String(def))) throw new ThemeError(`Setting "${key}" needs a valid hex colour.`);
    const options = Array.isArray(o.options)
      ? o.options.map((opt) => {
        const oo = (opt ?? {}) as Record<string, unknown>;
        const value = str(oo.value, 60);
        if (!value) throw new ThemeError(`Setting "${key}" has an option without a value.`);
        return { value, label: str(oo.label, 60) || value };
      }).slice(0, 24)
      : [];
    if (type === 'select' && !options.length) throw new ThemeError(`Setting "${key}" is a select but has no options.`);
    if (type === 'select' && options.length && !options.some((x) => x.value === String(def))) {
      def = options[0].value;
    }
    return {
      key, type, label, default: def, options,
      ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(step !== undefined ? { step } : {}),
      ...(str(o.help, 200) ? { help: str(o.help, 200) } : {}),
    };
  });
}

/** Validates one submitted Customizer value against the installed manifest schema. */
export function validateThemeSettingValue(setting: ThemeSetting, input: unknown): string {
  const value = String(input ?? '').trim().slice(0, 2000);
  switch (setting.type) {
    case 'toggle':
      return value === '1' || value === 'true' || value === 'on' ? '1' : '';
    case 'color':
      if (!COLOR.test(value)) throw new ThemeError(`“${setting.label}” must be a valid hex color.`);
      return value;
    case 'select':
      if (!(setting.options ?? []).some((option) => option.value === value)) {
        throw new ThemeError(`Choose an allowed value for “${setting.label}”.`);
      }
      return value;
    case 'number':
    case 'range': {
      if (!value) throw new ThemeError(`“${setting.label}” needs a number.`);
      const number = Number(value);
      if (!Number.isFinite(number)) throw new ThemeError(`“${setting.label}” must be a finite number.`);
      if (setting.min !== undefined && number < setting.min || setting.max !== undefined && number > setting.max) {
        throw new ThemeError(`“${setting.label}” must be between ${setting.min ?? '−∞'} and ${setting.max ?? '∞'}.`);
      }
      if (setting.step !== undefined && setting.min !== undefined) {
        const steps = (number - setting.min) / setting.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-7) throw new ThemeError(`“${setting.label}” must use increments of ${setting.step}.`);
      }
      return String(number);
    }
    case 'url':
    case 'image':
      if (!value) return '';
      if (!safeUrl(value)) throw new ThemeError(`“${setting.label}” must be a safe URL or CMS media path.`);
      return value;
    default:
      return value;
  }
}

/**
 * Validates and normalises a manifest. Accepts v1 (name/version/templates/css
 * only) and upgrades it, so every theme from before this release keeps working.
 */
export function parseManifest(input: unknown): { manifest: ThemeManifest; templates: Record<string, string>; partials: Record<string, string>; css: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ThemeError('theme.json must be a JSON object.');
  const o = input as Record<string, unknown>;
  const name = str(o.name, 80);
  if (!name) throw new ThemeError('The theme needs a "name".');
  const slug = slugify(str(o.slug, 40) || name);
  if (!slug) throw new ThemeError('The theme name must contain letters or digits.');
  const version = str(o.version, 20) || '1.0.0';
  const sourceManifestVersion = Number(o.manifest_version ?? o.manifestVersion ?? 1);
  if (sourceManifestVersion >= 3) {
    for (const field of ['slug', 'version', 'author', 'description', 'cms_compatibility', 'preview', 'screenshot',
      'required_templates', 'optional_templates', 'features', 'menu_locations', 'asset_entrypoints', 'settings_schema',
      'templates', 'partials', 'css', 'assets']) {
      if (!(field in o)) throw new ThemeError(`Version 3 manifests must declare "${field}".`);
    }
    if (!str(o.author, 60) || !str(o.description, 400)) throw new ThemeError('Version 3 manifests need an author and description.');
  }
  const compatibilityRaw = o.cms_compatibility && typeof o.cms_compatibility === 'object'
    ? o.cms_compatibility as Record<string, unknown>
    : {};
  const compatibilityMin = str(compatibilityRaw.min, 20);
  const compatibilityMax = str(compatibilityRaw.max, 20);
  if (sourceManifestVersion >= 3 && (!/^\d+\.\d+\.\d+$/.test(compatibilityMin)
    || (compatibilityMax && !/^\d+\.\d+\.(?:\d+|x|\*)$/i.test(compatibilityMax)))) {
    throw new ThemeError('Version 3 cms_compatibility must use min "major.minor.patch" and optional max "major.minor.patch" or "major.minor.x".');
  }
  const versionParts = (v: string): number[] => v.replace(/^[^0-9]*/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const versionCompare = (a: string, b: string): number => {
    const aa = versionParts(a), bb = versionParts(b);
    for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
      const d = (aa[i] ?? 0) - (bb[i] ?? 0);
      if (d) return d;
    }
    return 0;
  };
  if (compatibilityMin && versionCompare(APP_VERSION, compatibilityMin) < 0) {
    throw new ThemeError(`This theme needs Edge CMS ${compatibilityMin} or newer (this site is ${APP_VERSION}).`);
  }
  const maxPrefix = compatibilityMax?.replace(/[x*]$/i, '');
  if (compatibilityMax && !/[x*]$/i.test(compatibilityMax) && versionCompare(APP_VERSION, compatibilityMax) > 0) {
    throw new ThemeError(`This theme supports Edge CMS up to ${compatibilityMax} (this site is ${APP_VERSION}).`);
  }
  if (maxPrefix && /[x*]$/i.test(compatibilityMax)) {
    const maxParts = compatibilityMax.split('.');
    const currentParts = versionParts(APP_VERSION);
    if (maxParts.slice(0, -1).some((part, i) => Number(part) !== currentParts[i])) {
      throw new ThemeError(`This theme supports Edge CMS ${compatibilityMax} (this site is ${APP_VERSION}).`);
    }
  }
  // `preview` may be an array (v1) or an object carrying colours (v2/v3).
  const previewRaw = Array.isArray(o.preview) ? o.preview : (o.preview && typeof o.preview === 'object' ? (o.preview as Record<string, unknown>).colors : []);
  const preview = (Array.isArray(previewRaw) ? previewRaw : []).map((c) => str(c, 20)).filter((c) => COLOR.test(c)).slice(0, 3);
  if (sourceManifestVersion >= 3 && preview.length !== 3) throw new ThemeError('Version 3 manifests must include three valid preview colors.');
  const parentRaw = str(o.parent, 40);
  const parent = parentRaw ? slugify(parentRaw) : null;
  if (parent === slug) throw new ThemeError('A theme cannot be its own parent.');
  const layout = str(o.layout, 30) || 'base';
  if (!EXTRA_TEMPLATE.test(layout)) throw new ThemeError(`"layout" must name a template, not "${layout}".`);
  const tags = (Array.isArray(o.tags) ? o.tags : []).map((t) => str(t, 24)).filter(Boolean).slice(0, 8);
  const supports = (Array.isArray(o.supports) ? o.supports : []).map((t) => str(t, 24)).filter(Boolean).slice(0, 12);
  const stringList = (value: unknown, field: string, max = 16): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new ThemeError(`"${field}" must be a list.`);
    const values = value.map((x) => str(x, 40)).filter(Boolean);
    if (values.length > max || values.length !== new Set(values).size) throw new ThemeError(`"${field}" has too many or duplicate entries.`);
    return values;
  };
  const requiredTemplates = stringList(o.required_templates, 'required_templates', 32);
  const optionalTemplates = stringList(o.optional_templates, 'optional_templates', 32);
  const features = stringList(o.features, 'features', 32);
  const menuLocations = stringList(o.menu_locations, 'menu_locations', 8);
  const knownMenuLocations = new Set(['primary', 'secondary', 'footer', 'mobile']);
  for (const location of menuLocations) {
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(location) || !knownMenuLocations.has(location)) {
      throw new ThemeError(`Unsupported menu location "${location}".`);
    }
  }
  const required = requiredTemplates.length ? requiredTemplates : ['base'];
  for (const name of [...required, ...optionalTemplates]) {
    if (!(TEMPLATE_NAMES as readonly string[]).includes(name) && !EXTRA_TEMPLATE.test(name)) {
      throw new ThemeError(`Invalid template name "${name}" in the manifest.`);
    }
  }
  if (required.some((name) => optionalTemplates.includes(name))) throw new ThemeError('A template cannot be both required and optional.');
  const changelog = Array.isArray(o.changelog)
    ? o.changelog.slice(0, 20).map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      return { version: str(e.version, 20) || '—', notes: str(e.notes, 400) };
    }).filter((e) => e.notes)
    : [];
  const assets = (Array.isArray(o.assets) ? o.assets : Object.values(o.assets && typeof o.assets === 'object' ? o.assets as Record<string, unknown> : {}))
    .map((p) => cleanAssetPath(str(p, 120)))
    .filter(Boolean)
    .slice(0, MAX_ASSETS_PER_THEME);

  const widgets = parseWidgetAreas(o.widgets);
  const settings = parseSettings(o.settings_schema ?? o.settings);
  const entrypointsRaw = o.asset_entrypoints && typeof o.asset_entrypoints === 'object'
    ? o.asset_entrypoints as Record<string, unknown>
    : {};
  const entrypointCss = cleanAssetPath(str(entrypointsRaw.css, 120));
  const entrypointJs = stringList(entrypointsRaw.js, 'asset_entrypoints.js', 8).map(cleanAssetPath).filter(Boolean);
  if (sourceManifestVersion >= 3 && !entrypointCss) throw new ThemeError('Version 3 manifests need an asset_entrypoints.css path.');
  if (entrypointCss && !/^static\//.test(entrypointCss) && sourceManifestVersion >= 3) {
    throw new ThemeError('The v3 CSS entrypoint must be inside static/.');
  }
  const cssReference = typeof o.css === 'string' && /^[\w./-]+\.css$/i.test(o.css) ? cleanAssetPath(o.css) : '';
  if (sourceManifestVersion >= 3 && cssReference && cssReference !== entrypointCss) {
    throw new ThemeError('The "css" file and asset_entrypoints.css must name the same stylesheet.');
  }
  for (const path of entrypointJs) {
    if (!assets.includes(path)) throw new ThemeError(`JavaScript entrypoint "${path}" must be listed in "assets".`);
    if (!path.startsWith('static/') || !path.toLowerCase().endsWith('.js')) throw new ThemeError(`JavaScript entrypoint "${path}" must be a .js file inside static/.`);
  }

  const templatesDecl = o.templates ?? {};
  if (typeof templatesDecl !== 'object' || Array.isArray(templatesDecl)) throw new ThemeError('The theme needs a "templates" object.');
  const templates: Record<string, string> = {};
  for (const [key, value] of Object.entries(templatesDecl as Record<string, unknown>)) {
    if (typeof value !== 'string') throw new ThemeError(`Template "${key}" must be text.`);
    if (key === 'base' || (TEMPLATE_NAMES as readonly string[]).includes(key) || EXTRA_TEMPLATE.test(key)) templates[key] = value;
  }
  if (!templates.base && !parent) throw new ThemeError('The theme needs a "base" template (or a "parent" theme to inherit from).');
  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(templates, name) && !parent) {
      throw new ThemeError(`The required template "${name}" is missing.`);
    }
  }
  if (!parent) {
    const layoutName = str(o.layout, 30) || 'base';
    const layout = templates[layoutName] ?? templates.base ?? '';
    // The page body needs somewhere to land: v1 themes use {{{content}}}, v2 layouts
    // declare {{#block content}}. Without either, every page renders blank.
    if (!/\{\{\{?\s*content\s*\}?\}\}/.test(layout) && !/\{\{#block\s+content\}\}/.test(layout)) {
      throw new ThemeError(`The "${layoutName}" template must contain {{{content}}} (or {{#block content}}) where the page goes.`);
    }
  }

  const partialsDecl = o.partials ?? {};
  if (typeof partialsDecl !== 'object' || Array.isArray(partialsDecl)) throw new ThemeError('"partials" must be an object.');
  const partials: Record<string, string> = {};
  for (const [key, value] of Object.entries(partialsDecl as Record<string, unknown>)) {
    const clean = key.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!clean) continue;
    if (typeof value !== 'string') throw new ThemeError(`Partial "${key}" must be text.`);
    partials[clean] = value;
  }
  const css = typeof o.css === 'string' ? o.css : '';
  // Templates are stored in one D1 row; keep the whole bundle well under the row limit.
  if (JSON.stringify(templates).length + JSON.stringify(partials).length + css.length > 900 * 1024) {
    throw new ThemeError('The theme is too large (limit ~900 KB of templates, partials and CSS). Ships images and fonts as assets instead.');
  }
  const manifest: ThemeManifest = {
    name, slug, version,
    author: str(o.author, 60),
    authorUrl: str(o.authorUrl, 200),
    homepage: str(o.homepage, 200),
    description: str(o.description, 400),
    parent, layout, tags, supports,
    screenshot: cleanAssetPath(str(o.screenshot, 120)),
    preview, settings, settings_schema: settings, widgets, changelog, assets,
    cms_compatibility: { min: compatibilityMin || '0.0.0', ...(compatibilityMax ? { max: compatibilityMax } : {}) },
    required_templates: required, optional_templates: optionalTemplates, features,
    menu_locations: menuLocations.length ? menuLocations : ['primary', 'footer'],
    asset_entrypoints: {
      css: entrypointCss || cleanAssetPath(typeof o.css === 'string' && /^[\w./-]+\.css$/i.test(o.css) ? o.css : ''),
      js: entrypointJs,
    },
    manifest_version: sourceManifestVersion >= 3 ? 3 : 2,
  };
  return { manifest, templates, partials, css };
}

/* ------------------------------------------------------------------- zip */

/** A file from an uploaded zip: bytes plus the mime we assigned from its extension. */
export type UploadedAsset = { path: string; data: Uint8Array; mime: string };

export type ThemeUpload = {
  manifest: ThemeManifest;
  templates: Record<string, string>;
  partials: Record<string, string>;
  css: string;
  assets: UploadedAsset[];
  /** Files the zip contained that we will not store, with the reason. */
  skipped: { path: string; reason: string }[];
};

/** Resolves a path inside a zip, allowing it to be relative to the manifest's folder. */
export function zipReader(files: Map<string, Uint8Array>, dir: string) {
  const at = (ref: string): Uint8Array | undefined => {
    const clean = ref.replace(/\\/g, '/');
    if (!clean || clean.startsWith('/') || /^[a-z]:/i.test(clean) || clean.split('/').some((part) => !part || part === '.' || part === '..')) return undefined;
    return files.get(dir + clean);
  };
  const text = (ref: string): string | undefined => {
    const data = at(ref);
    return data ? new TextDecoder().decode(data) : undefined;
  };
  return { at, text, paths: () => [...files.keys()] };
}

/**
 * Turns a raw upload into a theme. JSON keeps working (one-file themes, and
 * every theme made before v2); a zip may carry templates, partials, CSS and
 * binary assets next to its manifest.
 */
export async function readThemeUpload(buf: ArrayBuffer, unzip: (b: ArrayBuffer) => Promise<Map<string, Uint8Array>>): Promise<ThemeUpload> {
  if (buf.byteLength > MAX_THEME_UPLOAD) throw new ThemeError(`The file is too large (limit ${Math.round(MAX_THEME_UPLOAD / 1048576)} MB).`);
  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new ThemeError('theme.json is not valid JSON.');
    }
  };
  const head = new Uint8Array(buf, 0, 4);
  const looksZipped = head.length === 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (!looksZipped) {
    const parsed = parseManifest(parse(new TextDecoder().decode(buf)));
    return { ...parsed, assets: [], skipped: [] };
  }

  let files: Map<string, Uint8Array>;
  try {
    files = await unzip(buf);
  } catch (err) {
    throw new ThemeError(err instanceof Error ? err.message : 'Could not read the zip file.');
  }
  const manifestPath = [...files.keys()].filter((p) => p === 'theme.json' || p.endsWith('/theme.json')).sort((a, b) => a.length - b.length)[0];
  if (!manifestPath) throw new ThemeError('The zip file does not contain a theme.json.');
  const dir = manifestPath.slice(0, -'theme.json'.length);
  const raw = parse(new TextDecoder().decode(files.get(manifestPath)!)) as Record<string, unknown>;
  const reader = zipReader(files, dir);
  const sourceManifestVersion = Number(raw.manifest_version ?? raw.manifestVersion ?? 1);
  if (sourceManifestVersion >= 3) {
    const root = manifestPath.split('/')[0];
    if (!root || manifestPath !== `${root}/theme.json` || [...files.keys()].some((path) => !path.startsWith(`${root}/`))) {
      throw new ThemeError('A version 3 theme ZIP must contain exactly one theme root directory with all files inside it.');
    }
    if (String(raw.slug || '') !== root) throw new ThemeError('The ZIP root folder must exactly match the theme slug.');
    const allowedFile = /\.(?:json|md|html?|css|js|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i;
    for (const path of files.keys()) {
      if (!allowedFile.test(path)) throw new ThemeError(`File "${path.slice(root.length + 1)}" has an unsupported package extension.`);
    }
  }
  if (typeof raw.settings_schema === 'string') {
    const ref = raw.settings_schema;
    if (!/^[a-z0-9._/-]+\.json$/i.test(ref) || ref.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new ThemeError('"settings_schema" must be a safe relative JSON path or a settings list.');
    }
    const text = reader.text(ref);
    if (text === undefined) throw new ThemeError(`theme.json names settings schema "${ref}" but that file is not in the zip.`);
    const config = parse(text);
    raw.settings_schema = Array.isArray(config) ? config : (config && typeof config === 'object'
      ? (config as Record<string, unknown>).settings_schema ?? (config as Record<string, unknown>).settings
      : undefined);
    if (!Array.isArray(raw.settings_schema)) throw new ThemeError(`The settings schema file "${ref}" must contain a settings list.`);
  }
  const skipped: { path: string; reason: string }[] = [];

  // Templates: a name may point at a file, or hold the markup inline (v1 style).
  const declared = (raw.templates && typeof raw.templates === 'object' ? raw.templates : {}) as Record<string, unknown>;
  const templates: Record<string, unknown> = {};
  for (const key of [...TEMPLATE_NAMES, ...Object.keys(declared)]) {
    if (templates[key] !== undefined) continue;
    const ref = declared[key];
    if (ref === undefined) {
      const auto = reader.text(`${key}.html`); // convention: base.html, home.html, …
      if (auto !== undefined) templates[key] = auto;
      continue;
    }
    if (typeof ref === 'string' && /^[\w./-]+\.html?$/i.test(ref)) {
      const text = reader.text(ref);
      if (text === undefined) throw new ThemeError(`theme.json names "${ref}" but that file is not in the zip.`);
      templates[key] = text;
    } else {
      templates[key] = ref;
    }
  }

  // Partials: same two forms as templates.
  const partialsDecl = (raw.partials && typeof raw.partials === 'object' ? raw.partials : {}) as Record<string, unknown>;
  const partials: Record<string, unknown> = {};
  for (const [key, ref] of Object.entries(partialsDecl)) {
    if (typeof ref !== 'string') continue;
    if (/^[\w./-]+\.html?$/i.test(ref)) {
      const text = reader.text(ref);
      if (text === undefined) throw new ThemeError(`theme.json names the partial "${ref}" but that file is not in the zip.`);
      partials[key] = text;
    } else partials[key] = ref;
  }
  // Convention: partials/*.html needs no declaration.
  for (const path of files.keys()) {
    const rel = path.startsWith(dir + 'partials/') ? path.slice(dir.length + 'partials/'.length) : '';
    if (!rel.endsWith('.html')) continue;
    const name = rel.slice(0, -'.html'.length).replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    if (name && partials[name] === undefined) partials[name] = new TextDecoder().decode(files.get(path)!);
  }

  const declaredCssEntrypoint = raw.asset_entrypoints && typeof raw.asset_entrypoints === 'object'
    ? (raw.asset_entrypoints as Record<string, unknown>).css
    : undefined;
  if (sourceManifestVersion >= 3 && raw.css !== declaredCssEntrypoint) {
    throw new ThemeError('The "css" file and asset_entrypoints.css must name the same stylesheet.');
  }
  let css: unknown = raw.css;
  if (typeof css === 'string' && /^[\w./-]+\.css$/i.test(css)) {
    css = reader.text(css);
    if (css === undefined) throw new ThemeError(`theme.json names "${raw.css}" but that file is not in the zip.`);
  } else if (css === undefined) {
    css = reader.text('style.css') ?? '';
  }

  // Binary assets: everything under assets/, plus anything the manifest lists.
  const wanted = new Set<string>();
  for (const path of files.keys()) {
    const rel = path.startsWith(dir) ? path.slice(dir.length) : '';
    if (rel.startsWith('assets/')) wanted.add(rel);
  }
  const assetsDecl = raw.assets;
  if (assetsDecl && typeof assetsDecl === 'object') {
    const values = Array.isArray(assetsDecl) ? assetsDecl : Object.values(assetsDecl as Record<string, unknown>);
    for (const ref of values) {
      if (typeof ref !== 'string') continue;
      const clean = cleanAssetPath(ref);
      if (sourceManifestVersion >= 3 && (!clean || clean !== ref || !files.has(dir + ref))) {
        throw new ThemeError(`Asset "${ref}" is unsafe or missing from the package.`);
      }
      wanted.add(ref.replace(/^\.?\/+/, ''));
    }
  }
  const assets: UploadedAsset[] = [];
  let total = 0;
  for (const rel of [...wanted].sort()) {
    // `style.css` is the stylesheet (already read above), never an asset: it is
    // text a manifest points at with `"css"`, and it is written back to the file
    // store by saveTheme so a v2 layout can link it.
    if (cleanAssetPath(rel) === 'style.css') continue;
    const path = cleanAssetPath(rel);
    const data = [...files.entries()].find(([p]) => p === dir + rel)?.[1];
    if (!data) continue;
    if (!path) {
      skipped.push({ path: rel, reason: 'not an allowed asset name' });
      continue;
    }
    if (isRefusedAsset(path)) {
      if (sourceManifestVersion >= 3) throw new ThemeError(`${path.slice(path.lastIndexOf('.') + 1).toUpperCase()} files are not allowed in a theme.`);
      skipped.push({ path: rel, reason: `${path.slice(path.lastIndexOf('.') + 1).toUpperCase()} files are not allowed in a theme` });
      continue;
    }
    const mime = assetMime(path);
    if (!mime) {
      if (sourceManifestVersion >= 3) throw new ThemeError(`Asset "${rel}" has an unsupported file type.`);
      skipped.push({ path: rel, reason: 'file type not allowed' });
      continue;
    }
    if (data.byteLength > MAX_THEME_ASSET) {
      if (sourceManifestVersion >= 3) throw new ThemeError(`Asset "${rel}" exceeds the ${Math.round(MAX_THEME_ASSET / 1024)} KB per-file limit.`);
      skipped.push({ path: rel, reason: `larger than ${Math.round(MAX_THEME_ASSET / 1024)} KB` });
      continue;
    }
    total += data.byteLength;
    if (total > MAX_THEME_ASSETS_TOTAL) throw new ThemeError(`The theme's assets are too large (limit ${Math.round(MAX_THEME_ASSETS_TOTAL / 1048576)} MB in total).`);
    if (assets.length >= MAX_ASSETS_PER_THEME) throw new ThemeError(`A theme may ship at most ${MAX_ASSETS_PER_THEME} asset files.`);
    assets.push({ path, data, mime });
  }

  const declaredAssets = (Array.isArray(assetsDecl) ? assetsDecl : [])
    .map((ref) => (typeof ref === 'string' ? cleanAssetPath(ref.replace(/^\.?\/+/, '')) : ''))
    .filter(Boolean);
  const parsed = parseManifest({ ...raw, assets: [...declaredAssets, ...assets.map((a) => a.path)], templates, partials, css });
  // `manifest.assets` stays what the author declared (the validator checks it is
  // shipped); `shipped` records what the archive actually contained.
  parsed.manifest.shipped = assets.map((a) => a.path);
  return { ...parsed, assets, skipped };
}

/* -------------------------------------------------------------- inheritance */

/**
 * Merges a theme over its parent: templates, partials and the manifest fields a
 * child may inherit (assets and the stylesheet list come from both).
 * Children win, parent fills gaps — that is the whole rule.
 */
export function inherit(child: ThemeBundle, parent: ThemeBundle | null): ThemeBundle {
  if (!parent) return child;
  return {
    ...child,
    templates: { ...parent.templates, ...child.templates },
    partials: { ...parent.partials, ...child.partials },
    css: child.css,
    manifest: {
      ...child.manifest,
      supports: [...new Set([...parent.manifest.supports, ...child.manifest.supports])],
      settings: child.manifest.settings.length ? child.manifest.settings : parent.manifest.settings,
      widgets: child.manifest.widgets?.length ? child.manifest.widgets : parent.manifest.widgets,
    },
  };
}

/** Defaults for a theme's declared settings, as the templates see them. */
export function settingDefaults(manifest: ThemeManifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of manifest.settings) out[s.key] = typeof s.default === 'boolean' ? (s.default ? '1' : '') : String(s.default);
  return out;
}

/** Merges saved values over defaults, ignoring keys the theme does not declare. */
export function resolveSettings(manifest: ThemeManifest, saved: Record<string, string> | null): Record<string, string> {
  const out = settingDefaults(manifest);
  if (!saved) return out;
  for (const s of manifest.settings) {
    const value = saved[s.key];
    if (value === undefined) continue;
    if (s.type === 'toggle') out[s.key] = value === '1' || value === 'true' ? '1' : '';
    else out[s.key] = String(value).slice(0, 2000);
  }
  return out;
}
