/**
 * The built-in theme store: themes shipped inside the app, installable from
 * Admin -> Themes with one click.
 *
 * The default theme is installed and used as the fallback. Example 1 is an
 * optional, independently installable theme for learning and customization.
 */
import { defaultTheme, defaultThemeFiles, type PackageFile } from './default';
import { exampleTheme, exampleThemeFiles } from './example1';
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
}, {
  ...exampleTheme,
  description: exampleTheme.manifest.description,
  preview: exampleTheme.manifest.preview,
  packageFiles: exampleThemeFiles,
}];
