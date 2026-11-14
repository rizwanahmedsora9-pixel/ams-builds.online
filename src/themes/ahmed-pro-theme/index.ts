/**
 * "Ahmed Pro Theme": the one bundled theme, and the default.
 *
 * This folder is the theme package exactly as it is uploaded (theme.json v3,
 * templates/, partials/, static/, config/), so the bundled copy and a ZIP of it
 * are the same theme. Two things differ from the ZIP on purpose:
 *   - `static/js/theme.js` is kept as `theme.js.txt`, so both bundlers import
 *     it as text (a `.js` import would be compiled into the app instead). It is
 *     still installed and served as `static/js/theme.js`.
 *   - the inline colour-scheme bootstrap in base.html carries `nonce="{{nonce}}"`
 *     so it runs under the site's Content-Security-Policy.
 *   - the footer includes `{{> social}}` (plus three CSS rules for it), so the
 *     "Show social links in the footer" option in Settings keeps working.
 *   - a post assigned to pages links back to them ("Back to <page>"), and the
 *     stylesheet ends with a section for markup the CMS itself renders (editor
 *     image/video blocks, page posts, widget areas).
 */
import rawManifest from './theme.json';
import settingsConfig from './config/settings.json';
import base from './templates/base.html';
import home from './templates/home.html';
import page from './templates/page.html';
import post from './templates/post.html';
import archive from './templates/archive.html';
import search from './templates/search.html';
import notFound from './templates/404.html';
import header from './partials/header.html';
import navigation from './partials/navigation.html';
import footer from './partials/footer.html';
import css from './static/css/style.css';
import themeJs from './static/js/theme.js.txt';
import screenshot from './screenshot.png';
import social from '../partials/social.html';

import type { ThemeBundle } from '../../lib/theme-manifest';
import { parseManifest } from '../../lib/theme-manifest';

export type { ThemeBundle };

/** A file of the bundled package that is served as a theme asset. */
export type PackageFile = { path: string; data: Uint8Array; mime: string };

const templates = { base, home, page, post, archive, search, '404': notFound };
// `social` is the CMS's shared partial for the site-wide profiles in Settings.
const partials = { header, navigation, footer, social };

/** The bundled manifest, validated by the same parser as an uploaded one. */
const parsed = parseManifest({
  ...rawManifest,
  // In the package `settings_schema` names config/settings.json; resolved here.
  settings_schema: settingsConfig.settings_schema,
  templates,
  partials,
  css,
});

/** Installed and activated by the installer, and the theme a site falls back to. */
export const defaultTheme: ThemeBundle = {
  name: parsed.manifest.name,
  slug: parsed.manifest.slug,
  version: parsed.manifest.version,
  templates: parsed.templates,
  partials: parsed.partials,
  css: parsed.css,
  manifest: parsed.manifest,
};

const bytes = (data: ArrayBuffer | Uint8Array): Uint8Array => (data instanceof Uint8Array ? data : new Uint8Array(data));

/**
 * The assets the theme's manifest lists (its script and its screenshot). The
 * stylesheet is not here: it is stored as `style.css` like every theme's.
 */
export const defaultThemeFiles: PackageFile[] = [
  { path: 'static/js/theme.js', data: new TextEncoder().encode(themeJs), mime: 'text/javascript; charset=utf-8' },
  { path: 'screenshot.png', data: bytes(screenshot), mime: 'image/png' },
];
