import manifest from './ahmed-starter/theme.json';
import settings from './ahmed-starter/config/settings.json';
import menus from './ahmed-starter/config/menus.json';
import base from './ahmed-starter/templates/base.html';
import home from './ahmed-starter/templates/home.html';
import page from './ahmed-starter/templates/page.html';
import post from './ahmed-starter/templates/post.html';
import archive from './ahmed-starter/templates/archive.html';
import search from './ahmed-starter/templates/search.html';
import notFound from './ahmed-starter/templates/404.html';
import header from './ahmed-starter/partials/header.html';
import navigation from './ahmed-starter/partials/navigation.html';
import footer from './ahmed-starter/partials/footer.html';
import css from './ahmed-starter/static/css/style.css';
import screenshotSource from './ahmed-starter/screenshot.png';
import type { ZipEntry } from '../lib/zip';

const sampleRoot = 'ahmed-starter-theme/';
const themeJs = `(function () {
  'use strict';
  var button = document.querySelector('.nav-toggle');
  var navigation = document.getElementById('primary-navigation');
  if (!button || !navigation) return;
  button.addEventListener('click', function () {
    var open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    navigation.classList.toggle('is-open', open);
  });
  navigation.addEventListener('click', function (event) {
    if (event.target && event.target.closest('a')) {
      button.setAttribute('aria-expanded', 'false');
      navigation.classList.remove('is-open');
    }
  });
})();
`;

const readme = `# Ahmed Starter Theme

A working starter for Edge CMS. It renders existing CMS pages, posts, navigation menus, identity, media, comments, and theme settings. No fake production content or core CMS edits are required.

## Edit and install

1. Extract this \`ahmed-starter-theme/\` folder.
2. Edit \`templates/\` and \`partials/\` for markup, \`static/css/style.css\` for styles, and \`static/js/theme.js\` for browser behavior.
3. Update \`theme.json\` and \`config/settings.json\` when changing the theme name, slug, compatibility, menu locations, or Customizer controls.
4. Repackage the single \`ahmed-starter-theme/\` directory as a ZIP without removing the root folder.
5. In **Appearance → Themes**, upload the ZIP, validate it, preview it, and activate it when ready.

Themes contain trusted visitor-facing HTML and JavaScript; they are not sandboxed. The template engine does not run Python or server-side JavaScript.

## Package map

- \`theme.json\`: version 3 manifest and file references.
- \`templates/\`: layout, home, page, post, archive, search, and not-found templates.
- \`partials/\`: shared header, navigation, and footer.
- \`static/css/style.css\`: responsive theme stylesheet.
- \`static/js/theme.js\`: dependency-free mobile navigation example.
- \`static/images/\` and \`static/fonts/\`: placeholders for permitted image and font assets.
- \`config/settings.json\`: per-theme Customizer controls.
- \`config/menus.json\`: supported CMS menu locations; menus stay in the CMS.
- \`screenshot.png\`: sample theme preview image.

## Template contract

Edge CMS uses its documented \`{{...}}\` template syntax, not Jinja. Ordinary values are escaped; use triple braces only for trusted HTML fields such as \`{{{page.content}}}\` and \`{{{comments_html}}}\`. Common data includes \`site.title\`, \`site.tagline\`, \`site.logo\`, \`menu.primary\`, \`menu.footer\`, \`pages\`, \`page.title\`, \`post.title\`, \`posts\`, \`archive.title\`, \`search.query\`, \`pagination.next\`, and \`theme.accent\`. See the CMS Theme Developer Guide for the complete context and helper reference.

Use \`{{asset "static/images/your-image.png"}}\` for theme assets. The CMS serves them from a theme-specific URL. The active stylesheet is linked through \`{{{theme_css_url}}}\`.

## Settings and navigation

Supported controls include text, textarea, toggle, color, select, number, image, and URL. Values persist independently per theme. Create and assign menus in the CMS Menus screen; this starter renders \`primary\` and \`footer\` without owning or replacing menu records. The CMS renders supported page hierarchy extras around page content.
`;

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const binary = (value: ArrayBuffer | Uint8Array): Uint8Array => value instanceof Uint8Array ? value : new Uint8Array(value);
const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';

/** Canonical sample package source; the admin download handler validates this ZIP with the upload parser. */
export function sampleThemeEntries(): ZipEntry[] {
  const prefix = sampleRoot;
  const png = binary(screenshotSource);
  return [
    { path: `${prefix}theme.json`, data: json(manifest) },
    { path: `${prefix}README.md`, data: readme },
    { path: `${prefix}screenshot.png`, data: png },
    { path: `${prefix}templates/base.html`, data: base },
    { path: `${prefix}templates/home.html`, data: home },
    { path: `${prefix}templates/page.html`, data: page },
    { path: `${prefix}templates/post.html`, data: post },
    { path: `${prefix}templates/archive.html`, data: archive },
    { path: `${prefix}templates/search.html`, data: search },
    { path: `${prefix}templates/404.html`, data: notFound },
    { path: `${prefix}partials/header.html`, data: header },
    { path: `${prefix}partials/navigation.html`, data: navigation },
    { path: `${prefix}partials/footer.html`, data: footer },
    { path: `${prefix}static/css/style.css`, data: css },
    { path: `${prefix}static/js/theme.js`, data: themeJs },
    { path: `${prefix}static/images/README.md`, data: 'Add permitted image assets here. Reference files through the asset helper.\n' },
    { path: `${prefix}static/fonts/README.md`, data: 'Add permitted WOFF, WOFF2, TTF, or OTF fonts here.\n' },
    { path: `${prefix}config/settings.json`, data: json(settings) },
    { path: `${prefix}config/menus.json`, data: json(menus) },
  ];
}
