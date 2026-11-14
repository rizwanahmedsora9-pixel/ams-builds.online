/**
 * The theme the app falls back to when there is no theme.
 *
 * Everything that needs "the theme when a site has none" — the renderer's
 * fallback for a theme that throws, and `activeThemeFor` for a site with no
 * active theme — imports it from here, so the fallback is one definition.
 *
 * The app ships no theme packages at all: no bundled design, no theme store, no
 * one-click installs. A site starts as a clean slate and looks like whatever
 * theme its owner uploads and activates. The fallback is bare semantic HTML
 * (see blank.ts), never a design of the app's own.
 */
export { blankTheme as defaultTheme, type ThemeBundle } from './blank';
