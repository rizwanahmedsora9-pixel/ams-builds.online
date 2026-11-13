import social from './partials/social.html';
/**
 * The built-in theme store: themes shipped inside the app, installable from
 * Admin -> Themes with one click. To add one, create a folder like ./nova/ and
 * list it here.
 *
 * Each bundled theme is parsed by the same manifest validator an upload goes
 * through, so a store theme can never be shaped differently from a real one.
 *
 * There is exactly one bundled theme now — AMS Nova — and it is the default
 * theme the installer writes and the theme a site falls back to.
 */
import { defaultTheme } from './nova';
import { parseManifest, type ThemeBundle, type ThemeManifest } from '../lib/theme-manifest';

export type StoreTheme = ThemeBundle & {
  description: string;
  preview: string[];
  /**
   * Files the app ships for this theme that a manifest cannot describe (a
   * binary screenshot). Written when the theme is installed, so an installed
   * store theme is complete rather than "mostly installed".
   */
  packageFiles?: { path: string; data: Uint8Array; mime: string }[];
};

/** Builds a store theme bundle from a manifest plus its files. */
function bundle(manifest: Record<string, unknown>, templates: Record<string, string>, css: string, partials: Record<string, string> = {}): StoreTheme {
  const parsed = parseManifest({ ...manifest, templates, partials, css });
  const m: ThemeManifest = parsed.manifest;
  return {
    name: m.name, slug: m.slug, version: m.version,
    templates: parsed.templates, partials: { ...parsed.partials, social }, css: parsed.css,
    manifest: m,
    description: m.description, preview: m.preview,
  };
}

/**
 * AMS Nova is both the bundled default theme and the one store card. Its card is
 * built from the very bundle that ships — not from a second copy of the files —
 * so the store, the installer and the fallback all agree on one theme.
 */
const nova = bundle(
  defaultTheme.manifest as unknown as Record<string, unknown>,
  defaultTheme.templates,
  defaultTheme.css,
  defaultTheme.partials,
);

export const storeThemes: StoreTheme[] = [nova];
