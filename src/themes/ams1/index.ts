import social from '../partials/social.html';
import manifest from './theme.json';
import base from './base.html';
import home from './home.html';
import page from './page.html';
import post from './post.html';
import archive from './archive.html';
import notFound from './404.html';
import tools from './tools.html';
import tool from './tool.html';
import services from './services.html';
import contact from './contact.html';
import footer from './partials/footer.html';
import css from './style.css';

import type { ThemeBundle } from '../../lib/theme-manifest';
import { parseManifest } from '../../lib/theme-manifest';

export type { ThemeBundle };

export const TEMPLATE_NAMES = ['base', 'home', 'page', 'post', 'archive', '404', 'tools', 'tool', 'services', 'contact'] as const;

const templates = {
  base, home, page, post, archive, '404': notFound,
  // The extra page layouts this theme ships. A page renders with one of these
  // through the editor's Template dropdown (`content.template`).
  tools, tool, services, contact,
};
const partials = { footer, social };

/** The bundled manifest, validated by the same parser as an uploaded one. */
const parsed = parseManifest({ ...manifest, templates, partials });

/**
 * "AMS 1": the flagship theme, installed and activated by the installer, and the
 * theme a site falls back to when the active theme cannot render.
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
