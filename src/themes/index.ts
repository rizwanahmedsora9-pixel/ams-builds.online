/**
 * The built-in theme store: themes shipped inside the app, installable from
 * Admin -> Themes with one click. To add one, create a folder like ./pro/ and
 * list it here.
 *
 * Each bundled theme is parsed by the same manifest validator an upload goes
 * through, so a store theme can never be shaped differently from a real one.
 */
import { defaultTheme } from './default';
import baseManifest from './default/theme.json';
import proManifest from './pro/theme.json';
import proBase from './pro/base.html';
import proHome from './pro/home.html';
import proPage from './pro/page.html';
import proPost from './pro/post.html';
import proArchive from './pro/archive.html';
import proNotFound from './pro/404.html';
import proCss from './pro/style.css';
import premiumManifest from './premium/theme.json';
import premiumBase from './premium/base.html';
import premiumHome from './premium/home.html';
import premiumCss from './premium/style.css';
import { parseManifest, type ThemeBundle, type ThemeManifest } from '../lib/theme-manifest';

export type StoreTheme = ThemeBundle & { description: string; preview: string[] };

/** Builds a store theme bundle from a manifest plus its files. */
function bundle(manifest: Record<string, unknown>, templates: Record<string, string>, css: string, partials: Record<string, string> = {}): StoreTheme {
  const parsed = parseManifest({ ...manifest, templates, partials, css });
  const m: ThemeManifest = parsed.manifest;
  return {
    name: m.name, slug: m.slug, version: m.version,
    templates: parsed.templates, partials: parsed.partials, css: parsed.css,
    manifest: m,
    description: m.description, preview: m.preview,
  };
}

const pro = bundle(
  proManifest as unknown as Record<string, unknown>,
  { base: proBase, home: proHome, page: proPage, post: proPost, archive: proArchive, '404': proNotFound },
  proCss,
);

/**
 * Premium inherits Pro's inner templates explicitly (`"parent": "ams-pro"`)
 * instead of copying them: the store now demonstrates layout inheritance, and
 * a fix to Pro's post markup reaches Premium too. Premium ships its own layout,
 * home page, stylesheet and partials.
 */
const premium = bundle(
  { ...(premiumManifest as unknown as Record<string, unknown>), parent: 'ams-pro' },
  { base: premiumBase, home: premiumHome },
  premiumCss,
);

export const storeThemes: StoreTheme[] = [
  { ...defaultTheme, description: defaultTheme.manifest.description, preview: defaultTheme.manifest.preview },
  pro,
  premium,
];
