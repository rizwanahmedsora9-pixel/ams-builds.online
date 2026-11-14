/**
 * The built-in theme store: themes shipped inside the app, installable from
 * Admin -> Themes with one click.
 *
 * There is exactly one bundled theme — the default theme (./default.ts) — and
 * it is the theme the installer writes and the theme a site falls back to. Its
 * store card is built from the very bundle that ships, not from a second copy
 * of the files, so the store, the installer and the fallback all agree.
 */
import { defaultTheme, defaultThemeFiles, type PackageFile } from './default';
import type { ThemeBundle } from '../lib/theme-manifest';

export type StoreTheme = ThemeBundle & {
  description: string;
  preview: string[];
  /**
   * Files the app ships for this theme besides its templates and stylesheet
   * (its script, its screenshot). Written when the theme is installed, so an
   * installed store theme is complete rather than "mostly installed".
   */
  packageFiles?: PackageFile[];
};

export const storeThemes: StoreTheme[] = [{
  ...defaultTheme,
  description: defaultTheme.manifest.description,
  preview: defaultTheme.manifest.preview,
  packageFiles: defaultThemeFiles,
}];
