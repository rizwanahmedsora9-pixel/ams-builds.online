/**
 * The built-in theme store: themes shipped inside the app, installable from
 * Admin -> Themes with one click. To add one, create a folder like ./pro/ and
 * list it here.
 */
import { defaultTheme, type ThemeBundle } from './default';
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

export type StoreTheme = ThemeBundle & { description: string; preview: string[] };

const pro: StoreTheme = {
  name: proManifest.name, slug: proManifest.slug, version: proManifest.version,
  description: proManifest.description, preview: proManifest.preview,
  templates: { base: proBase, home: proHome, page: proPage, post: proPost, archive: proArchive, '404': proNotFound },
  css: proCss,
};

// Premium has its own layout, home page and stylesheet; its inner page, post,
// archive and 404 templates use the same markup as Pro.
const premium: StoreTheme = {
  name: premiumManifest.name, slug: premiumManifest.slug, version: premiumManifest.version,
  description: premiumManifest.description, preview: premiumManifest.preview,
  templates: { base: premiumBase, home: premiumHome, page: proPage, post: proPost, archive: proArchive, '404': proNotFound },
  css: premiumCss,
};

export const storeThemes: StoreTheme[] = [
  { ...defaultTheme, description: baseManifest.description, preview: baseManifest.preview },
  pro,
  premium,
];
