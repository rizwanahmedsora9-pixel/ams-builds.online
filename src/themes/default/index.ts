import manifest from './theme.json';
import base from './base.html';
import home from './home.html';
import page from './page.html';
import post from './post.html';
import archive from './archive.html';
import notFound from './404.html';
import css from './style.css';

/** A theme bundle exactly as it is stored in D1 (and as an uploadable JSON theme looks). */
export type ThemeBundle = {
  name: string;
  slug: string;
  version: string;
  templates: Record<string, string>;
  css: string;
};

export const TEMPLATE_NAMES = ['base', 'home', 'page', 'post', 'archive', '404'] as const;

export const defaultTheme: ThemeBundle = {
  name: manifest.name,
  slug: manifest.slug,
  version: manifest.version,
  templates: { base, home, page, post, archive, '404': notFound },
  css,
};
