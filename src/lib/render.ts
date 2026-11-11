import type { Config, Env } from '../types';
import type { Settings } from './config';
import { esc } from './security';
import { defaultTheme, type ThemeBundle } from '../themes/default';

/* ---------------------------------------------------------- template engine
 * {{path}}            HTML-escaped value        {{{path}}}   raw value
 * {{#if path}} ... {{else}} ... {{/if}}         {{#unless path}} ... {{/unless}}
 * {{#each path}} ... {{else}} ... {{/each}}     (item fields, {{this}}, outer scope all resolve)
 * Templates are data, never code: nothing in a template can execute.
 */
type Block = { t: 'block'; k: 'if' | 'unless' | 'each'; p: string; body: Node[]; alt: Node[] };
type Node = string | { t: 'var'; p: string; raw: boolean } | Block;

const TOKEN = /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([#/]?[\w.]+)(?:\s+([\w.]+))?\s*\}\}/g;
const compiled = new Map<string, Node[]>();

function parse(src: string): Node[] {
  const root: Node[] = [];
  const stack: { node: Block; alt: boolean }[] = [];
  const cur = (): Node[] => {
    const top = stack[stack.length - 1];
    return top ? (top.alt ? top.node.alt : top.node.body) : root;
  };
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    if (m.index > last) cur().push(src.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      cur().push({ t: 'var', p: m[1], raw: true });
      continue;
    }
    const head = m[2];
    const top = stack[stack.length - 1];
    if (head[0] === '#') {
      const k = head.slice(1);
      if ((k === 'if' || k === 'unless' || k === 'each') && m[3]) {
        const node: Block = { t: 'block', k, p: m[3], body: [], alt: [] };
        cur().push(node);
        stack.push({ node, alt: false });
      }
    } else if (head[0] === '/') {
      if (top && top.node.k === head.slice(1)) stack.pop();
    } else if (head === 'else' && !m[3] && top) {
      top.alt = true;
    } else if (!m[3]) {
      cur().push({ t: 'var', p: head, raw: false });
    }
  }
  if (last < src.length) cur().push(src.slice(last));
  return root;
}

function lookup(scopes: unknown[], path: string): unknown {
  if (path === 'this') return scopes[scopes.length - 1];
  const [first, ...rest] = path.split('.');
  let value: unknown;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (s && typeof s === 'object' && Object.prototype.hasOwnProperty.call(s, first)) {
      value = (s as Record<string, unknown>)[first];
      break;
    }
  }
  for (const key of rest) {
    if (value == null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

const truthy = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : !!v);

function run(nodes: Node[], scopes: unknown[]): string {
  let out = '';
  for (const n of nodes) {
    if (typeof n === 'string') out += n;
    else if (n.t === 'var') {
      const v = lookup(scopes, n.p);
      if (v != null && typeof v !== 'object') out += n.raw ? String(v) : esc(v);
    } else {
      const v = lookup(scopes, n.p);
      if (n.k === 'each') {
        if (Array.isArray(v) && v.length) for (const item of v) out += run(n.body, [...scopes, item]);
        else out += run(n.alt, scopes);
      } else {
        out += run(truthy(v) === (n.k === 'if') ? n.body : n.alt, scopes);
      }
    }
  }
  return out;
}

export function renderTemplate(src: string, data: Record<string, unknown>): string {
  let nodes = compiled.get(src);
  if (!nodes) {
    nodes = parse(src);
    if (compiled.size > 64) compiled.clear();
    compiled.set(src, nodes);
  }
  return run(nodes, [data]);
}

/* -------------------------------------------------------------------- theme */

export async function activeTheme(env: Env): Promise<ThemeBundle> {
  try {
    const row = await env.DB.prepare('SELECT slug, name, version, templates, css FROM themes WHERE active=1 LIMIT 1')
      .first<{ slug: string; name: string; version: string; templates: string; css: string }>();
    if (row) {
      const templates = JSON.parse(row.templates) as Record<string, string>;
      if (typeof templates.base === 'string') return { ...row, templates: { ...defaultTheme.templates, ...templates } };
    }
  } catch {
    /* fall through to the bundled theme */
  }
  return defaultTheme;
}

type MenuItem = { label: string; url: string; active: boolean };

async function loadMenus(env: Env, path: string): Promise<Record<string, MenuItem[]>> {
  const { results } = await env.DB.prepare(
    "SELECT m.location, i.label, i.url FROM menus m JOIN menu_items i ON i.menu_id=m.id WHERE m.site_id=1 AND m.location<>'' ORDER BY i.position, i.id",
  ).all<{ location: string; label: string; url: string }>();
  const out: Record<string, MenuItem[]> = {};
  for (const r of results) (out[r.location] ||= []).push({ label: r.label, url: r.url, active: r.url === path });
  return out;
}

export type PageMeta = {
  title: string; // already includes the site name when wanted
  description?: string;
  canonical?: string; // path
  image?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
};

function buildHead(meta: PageMeta, settings: Settings, origin: string): string {
  const tags = [`<title>${esc(meta.title)}</title>`];
  if (meta.description) tags.push(`<meta name="description" content="${esc(meta.description)}">`);
  if (meta.noindex) tags.push('<meta name="robots" content="noindex">');
  if (meta.canonical) tags.push(`<link rel="canonical" href="${esc(origin + meta.canonical)}">`);
  tags.push(`<meta property="og:title" content="${esc(meta.title)}">`, `<meta property="og:type" content="${meta.type || 'website'}">`);
  if (meta.description) tags.push(`<meta property="og:description" content="${esc(meta.description)}">`);
  if (meta.image) tags.push(`<meta property="og:image" content="${esc(meta.image.startsWith('/') ? origin + meta.image : meta.image)}">`);
  if (settings.favicon) tags.push(`<link rel="icon" href="${esc(settings.favicon)}">`);
  // Admin-only custom code (Settings are writable by admins only), injected raw by design.
  if (settings.custom_css) tags.push(`<style>${settings.custom_css.replace(/<\/style/gi, '<\\/style')}</style>`);
  if (settings.custom_head) tags.push(settings.custom_head);
  return tags.join('\n');
}

function buildFooter(settings: Settings): string {
  const parts: string[] = [];
  if (settings.custom_footer) parts.push(settings.custom_footer);
  if (settings.custom_js) parts.push(`<script>${settings.custom_js.replace(/<\/script/gi, '<\\/script')}</script>`);
  return parts.join('\n');
}

/** Renders `template` inside the active theme's base layout and returns the full HTML document. */
export async function renderTheme(
  env: Env,
  opts: { settings: Settings; url: URL; template: string; meta: PageMeta; data: Record<string, unknown> },
): Promise<string> {
  const { settings, url } = opts;
  const [theme, menu] = await Promise.all([activeTheme(env), loadMenus(env, url.pathname)]);
  const shared = {
    site: { title: settings.site_title || '', tagline: settings.tagline || '', url: url.origin },
    menu,
    year: new Date().getUTCFullYear(),
    body_class: `tpl-${opts.template}`,
    ...opts.data,
  };
  const inner = renderTemplate(theme.templates[opts.template] ?? theme.templates.page ?? '', shared);
  return renderTemplate(theme.templates.base, {
    ...shared,
    content: inner,
    theme_css: theme.css.replace(/<\/style/gi, '<\\/style'),
    head: buildHead(opts.meta, settings, url.origin),
    footer: buildFooter(settings),
  });
}

/* --------------------------------------------------------------- page cache */

export const cacheKey = (cfg: Config, url: URL): string => `page:${cfg.cacheV}:${url.host}:${url.pathname}`;
export const PAGE_CACHE_TTL = 60 * 60 * 24;
