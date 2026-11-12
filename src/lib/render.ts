import type { Config, Env } from '../types';
import type { Settings } from './config';
import { commentToken, commentsEnabled, approvedComments, renderCommentsHtml, type CommentRow } from './comments';
import { esc } from './security';
import { listPages } from './content';
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

function buildHead(meta: PageMeta, settings: Settings, origin: string, extra = ''): string {
  const tags = [`<title>${esc(meta.title)}</title>`];
  if (meta.description) tags.push(`<meta name="description" content="${esc(meta.description)}">`);
  if (meta.noindex) tags.push('<meta name="robots" content="noindex">');
  if (meta.canonical) tags.push(`<link rel="canonical" href="${esc(origin + meta.canonical)}">`);
  tags.push(`<meta property="og:title" content="${esc(meta.title)}">`, `<meta property="og:type" content="${meta.type || 'website'}">`);
  if (meta.description) tags.push(`<meta property="og:description" content="${esc(meta.description)}">`);
  if (meta.image) tags.push(`<meta property="og:image" content="${esc(meta.image.startsWith('/') ? origin + meta.image : meta.image)}">`);
  if (settings.favicon) tags.push(`<link rel="icon" href="${esc(settings.favicon)}">`);
  // Admin-only custom code (Settings are writable by admins only), injected raw by design.
  // Feed autodiscovery (the RSS plugin can be switched off under Plugins).
  if (settings.plugin_rss !== '0') tags.push(`<link rel="alternate" type="application/rss+xml" title="${esc(settings.site_title || 'RSS')}" href="${esc(origin)}/feed.xml">`);
  if (settings.custom_css) tags.push(`<style>${settings.custom_css.replace(/<\/style/gi, '<\\/style')}</style>`);
  if (settings.custom_head) tags.push(settings.custom_head);
  if (extra) tags.push(extra);
  return tags.join('\n');
}

function buildFooter(settings: Settings, extra = ''): string {
  const parts: string[] = [];
  if (settings.custom_footer) parts.push(settings.custom_footer);
  if (extra) parts.push(extra);
  const widgets = widgetAreas(settings);
  if (widgets) parts.push(widgets);
  if (settings.custom_js) parts.push(`<script>${settings.custom_js.replace(/<\/script/gi, '<\\/script')}</script>`);
  return parts.join('\n');
}

/** Footer widget slots (Admin -> Appearance -> Widgets). Titles are escaped, bodies are admin HTML. */
function widgetAreas(settings: Settings): string {
  const slots: string[] = [];
  for (const n of [1, 2, 3]) {
    const body = (settings[`widget_footer_${n}_body`] || '').trim();
    if (!body) continue;
    const title = (settings[`widget_footer_${n}_title`] || '').trim();
    slots.push(`<div class="widget site-widget">${title ? `<h2 class="widget-title">${esc(title)}</h2>` : ''}${body}</div>`);
  }
  return slots.length ? `<div class="site-widgets"><div class="wrap"><div class="site-widgets-grid">${slots.join('')}</div></div></div>` : '';
}

/** Snippet hooks saved under Admin -> Plugins (raw code, admin only). */
async function loadHooks(env: Env): Promise<Record<'head' | 'footer', string[]>> {
  const out: Record<'head' | 'footer', string[]> = { head: [], footer: [] };
  try {
    const { results } = await env.DB.prepare("SELECT hook, code FROM hooks WHERE site_id=1 AND enabled=1 AND hook IN ('head','footer') ORDER BY id")
      .all<{ hook: 'head' | 'footer'; code: string }>();
    for (const r of results) out[r.hook].push(r.code);
  } catch {
    /* table missing on an old database */
  }
  return out;
}

/** Renders `template` inside the active theme's base layout and returns the full HTML document. */
/** A specific installed theme by slug, for previews. Null when it is not installed. */
export async function themeBySlug(env: Env, slug: string): Promise<ThemeBundle | null> {
  try {
    const row = await env.DB.prepare('SELECT slug, name, version, templates, css FROM themes WHERE slug=? LIMIT 1')
      .bind(slug).first<{ slug: string; name: string; version: string; templates: string; css: string }>();
    if (!row) return null;
    const templates = JSON.parse(row.templates) as Record<string, string>;
    return { ...row, templates: { ...defaultTheme.templates, ...templates } };
  } catch {
    return null;
  }
}

export async function renderTheme(
  env: Env,
  opts: {
    cfg: Config; settings: Settings; url: URL; template: string; meta: PageMeta;
    data: Record<string, unknown>;
    /** Render with this theme instead of the active one (admin previews). */
    theme?: ThemeBundle;
  },
): Promise<string> {
  const { settings, url } = opts;
  const [theme, menu, hooks, pageRows] = await Promise.all([
    opts.theme ? Promise.resolve(opts.theme) : activeTheme(env),
    loadMenus(env, url.pathname), loadHooks(env), listPages(env, { limit: 100 }),
  ]);

  // Comments: rendered for posts that have them, in any theme.
  let commentRows: CommentRow[] = [];
  let commentsHtml = '';
  const post = opts.template === 'post' ? (opts.data.post as { id: number } | undefined) : undefined;
  if (post) {
    commentRows = await approvedComments(env, post.id);
    const open = commentsEnabled(settings);
    if (commentRows.length || open) {
      commentsHtml = renderCommentsHtml({
        comments: commentRows,
        count: commentRows.length,
        tz: settings.timezone || 'UTC',
        contentId: post.id,
        token: open ? await commentToken(opts.cfg.secret, post.id) : '',
        open,
        notice: opts.data.comment_notice as string | undefined,
        replyTo: Number(opts.data.reply_to) || 0,
      });
    }
  }

  const shared = {
    site: { title: settings.site_title || '', tagline: settings.tagline || '', url: url.origin },
    menu,
    // {{#each pages}} - every published page in editor order, for a nav of its own.
    pages: pageRows.map((p) => ({
      title: p.title, slug: p.slug,
      url: settings.home_page_id === String(p.id) ? '/' : '/' + p.slug,
    })),
    year: new Date().getUTCFullYear(),
    body_class: `tpl-${opts.template}`,
    comments: commentRows.map((c) => ({ id: c.id, name: c.author_name, body: c.body, date: c.created_at })),
    comments_count: commentRows.length,
    comments_open: commentsEnabled(settings),
    comments_html: commentsHtml,
    ...opts.data,
  };
  const source = theme.templates[opts.template] ?? theme.templates.page ?? '';
  let inner = renderTemplate(source, shared);
  // A theme that does not use {{{comments_html}}} still gets its comments, after the content.
  if (commentsHtml && !/\{\{\{?\s*comments_html\s*\}?\}\}/.test(source)) {
    inner += `\n<div class="comments-fallback">${commentsHtml}</div>`;
  }
  return renderTemplate(theme.templates.base, {
    ...shared,
    comments_html: commentsHtml,
    content: inner,
    theme_css: theme.css.replace(/<\/style/gi, '<\\/style'),
    head: buildHead(opts.meta, settings, url.origin, hooks.head.join('\n')),
    footer: buildFooter(settings, hooks.footer.join('\n')),
  });
}

/* --------------------------------------------------------------- page cache */

export const cacheKey = (cfg: Config, url: URL): string => `page:${cfg.cacheV}:${url.host}:${url.pathname}`;
export const PAGE_CACHE_TTL = 60 * 60 * 24;
