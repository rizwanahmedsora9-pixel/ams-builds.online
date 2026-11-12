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
import journalManifest from './journal/theme.json';
import journalBase from './journal/base.html';
import journalHome from './journal/home.html';
import journalPage from './journal/page.html';
import journalPost from './journal/post.html';
import journalArchive from './journal/archive.html';
import journal404 from './journal/404.html';
import journalHeader from './journal/partials/header.html';
import journalFooter from './journal/partials/footer.html';
import journalCss from './journal/style.css';
import journalShot from './journal/screenshot.png';
import portfolioManifest from './portfolio/theme.json';
import portfolioBase from './portfolio/base.html';
import portfolioHome from './portfolio/home.html';
import portfolioPage from './portfolio/page.html';
import portfolioPost from './portfolio/post.html';
import portfolioArchive from './portfolio/archive.html';
import portfolio404 from './portfolio/404.html';
import portfolioHero from './portfolio/partials/hero.html';
import portfolioFooter from './portfolio/partials/footer.html';
import portfolioCss from './portfolio/style.css';
import portfolioShot from './portfolio/screenshot.png';
import premiumManifest from './premium/theme.json';
import premiumBase from './premium/base.html';
import premiumHome from './premium/home.html';
import premiumCss from './premium/style.css';
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

/**
 * A store theme that ships a screenshot. The file is bundled as bytes, so the
 * installer writes exactly the PNG the theme's zip would carry and the preview
 * card can show it without a second upload step.
 */
/**
 * A store theme that ships a screenshot. The installer writes exactly the PNG the
 * theme's zip would carry, so the store card can show the real thing.
 */
function withScreenshot(theme: StoreTheme, path: string, source: PackagedBytes): StoreTheme {
  // The bytes are inlined by both builds: esbuild's `binary` loader gives a
  // Uint8Array on Node, Wrangler's Data rule an ArrayBuffer.
  const data = source instanceof Uint8Array ? source : new Uint8Array(source);
  return { ...theme, packageFiles: [{ path, data, mime: 'image/png' }] };
}

const journal = withScreenshot(
  bundle(
    journalManifest as unknown as Record<string, unknown>,
    { base: journalBase, home: journalHome, page: journalPage, post: journalPost, archive: journalArchive, '404': journal404 },
    journalCss,
    { header: journalHeader, footer: journalFooter },
  ),
  'screenshot.png',
  journalShot,
);

const portfolio = withScreenshot(
  bundle(
    portfolioManifest as unknown as Record<string, unknown>,
    { base: portfolioBase, home: portfolioHome, page: portfolioPage, post: portfolioPost, archive: portfolioArchive, '404': portfolio404 },
    portfolioCss,
    { hero: portfolioHero, footer: portfolioFooter },
  ),
  'screenshot.png',
  portfolioShot,
);

export const storeThemes: StoreTheme[] = [
  { ...defaultTheme, description: defaultTheme.manifest.description, preview: defaultTheme.manifest.preview },
  pro,
  premium,
  journal,
  portfolio,
];
