import social from '../partials/social.html';
import manifest from './theme.json';
import base from './base.html';
import home from './home.html';
import page from './page.html';
import post from './post.html';
import archive from './archive.html';
import notFound from './404.html';
import css from './style.css';

import type { ThemeBundle } from '../../lib/theme-manifest';
import { parseManifest } from '../../lib/theme-manifest';

export type { ThemeBundle };

export const TEMPLATE_NAMES = ['base', 'home', 'page', 'post', 'archive', '404'] as const;

const templates = { base, home, page, post, archive, '404': notFound };
/** The bundled manifest, validated by the same parser as an uploaded one. */
const parsed = parseManifest({ ...manifest, templates });

/** "AMS Base": the standard theme, installed and activated by the installer. */
export const defaultTheme: ThemeBundle = {
  name: manifest.name,
  slug: manifest.slug,
  version: manifest.version,
  templates,
  partials: { social },
  css,
  manifest: parsed.manifest,
};
