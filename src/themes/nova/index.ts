import social from '../partials/social.html';
import manifest from './theme.json';
import base from './base.html';
import home from './home.html';
import page from './page.html';
import post from './post.html';
import archive from './archive.html';
import notFound from './404.html';
import footer from './partials/footer.html';
import css from './style.css';

import type { ThemeBundle } from '../../lib/theme-manifest';
import { parseManifest } from '../../lib/theme-manifest';

export type { ThemeBundle };

export const TEMPLATE_NAMES = ['base', 'home', 'page', 'post', 'archive', '404'] as const;

const templates = { base, home, page, post, archive, '404': notFound };
const partials = { footer, social };

/** The bundled manifest, validated by the same parser as an uploaded one. */
const parsed = parseManifest({ ...manifest, templates, partials });

/**
 * "AMS Nova": the single default theme. A full-colour sidebar-navigation theme
 * with dark and light options, a hero header, cards, a footer and AdSense-ready
 * ad slots. Installed and activated by the installer, and the fallback theme.
 */
export const defaultTheme: ThemeBundle = {
  name: manifest.name,
  slug: manifest.slug,
  version: manifest.version,
  templates,
  partials,
  css,
  manifest: parsed.manifest,
};
