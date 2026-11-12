/**
 * Admin asset bundles.
 *
 * The panel used to inline one 31 KB CSS string into every response. It is now
 * served as three cacheable files:
 *
 *   tokens.css   design tokens (colours, space, radius, type) per scheme
 *   app.css      shell + component kit
 *   screens.css  one screen family per source file, concatenated in order
 *
 * Editing any file changes APP_VERSION or the file itself; the URL carries a
 * version stamp and the response is immutable for a year, so a deploy is the
 * only thing that can invalidate it.
 */
import { html, raw } from '../lib/ui';
import { APP_VERSION } from '../lib/version';
import tokensCss from './assets/tokens.css';
import appCss from './assets/app.css';
import legacyScreens from './assets/screens/legacy.css';
import listScreens from './assets/screens/lists.css';
import dashboardScreens from './assets/screens/dashboard.css';
import editorScreens from './assets/screens/editor.css';
import { iconSprite } from './icons';

/** Kept as a module so the login/installer shell (which has no admin URL) can inline it. */
export const ADMIN_CSS = `${tokensCss}\n${appCss}\n${dashboardScreens}\n${listScreens}\n${editorScreens}\n${legacyScreens}`;

export type BundleName = 'app' | 'tokens' | 'screens';

const BUNDLES: Record<BundleName, { css: string; etag: string }> = (() => {
  const build = (css: string) => ({ css, etag: `"${APP_VERSION}-${hash(css)}"` });
  return {
    app: build(appCss),
    tokens: build(tokensCss),
    screens: build(`${dashboardScreens}\n${listScreens}\n${editorScreens}\n${legacyScreens}`),
  };
})();

/** FNV-1a: 7 characters are plenty to bust a cache when the text changes. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function getBundle(name: string): { css: string; etag: string } | null {
  return BUNDLES[name as BundleName] ?? null;
}

export const assetVersion = (name: BundleName): string => BUNDLES[name].etag.slice(1, -1);

/** The <link> tags for a panel document, in cascade order. */
export function assetLinks(adminBase: string, extra: BundleName[] = []): ReturnType<typeof raw> {
  return raw(
    (['tokens', ...extra, 'app', 'screens'] as BundleName[])
      .map((name) => `<link rel="stylesheet" href="${adminBase}/assets/${name}.css?v=${assetVersion(name)}">`)
      .join(''),
  );
}

/**
 * Everything a panel document needs for scripts: the icon sprite and the shared
 * behaviour (confirm prompts, toasts, user menu). Screens add their own.
 */
export function documentExtras(): ReturnType<typeof html> {
  return html`${iconSprite()}`;
}
