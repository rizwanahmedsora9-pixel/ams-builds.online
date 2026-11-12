import type { Config, Env } from '../types';
import type { Settings } from './config';
import { commentToken, commentsEnabled, approvedComments, renderCommentsHtml, type CommentRow } from './comments';
import { esc } from './security';
import { listPages } from './content';
import { defaultTheme } from '../themes/default';
import type { ThemeBundle } from './theme-manifest';
import { applyLayout, loadTheme, renderWithTheme, themeAssetUrl } from './theme-store';
import { cspFor, nonceFor } from './security';

export type { ThemeBundle } from './theme-manifest';

/** Kept for callers that only need the engine: the v2 implementation. */
export { render as renderTemplate } from './template';
export { render as renderTemplateHooks } from './template';

/* -------------------------------------------------------------------- theme */

/** The active theme, merged with its parent; the bundled theme when there is none. */
export async function activeTheme(env: Env): Promise<ThemeBundle> {
  try {
    const hit = await env.DB.prepare('SELECT slug FROM themes WHERE active=1 LIMIT 1').first<{ slug: string }>();
    if (hit) {
      const theme = await loadTheme(env, { slug: hit.slug });
      if (theme && (theme.templates.base || theme.manifest.parent)) return theme;
    }
  } catch {
    /* no themes table yet: use the bundled theme */
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

function buildHead(meta: PageMeta, settings: Settings, origin: string, extra = '', nonce = ''): string {
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
  // Admin-authored CSS/JS carry the per-response CSP nonce, so the Content-Security-Policy
  // can be strict without breaking the site's own customisations.
  if (settings.custom_css) tags.push(`<style${nonce ? ` nonce="${nonce}"` : ''}>${settings.custom_css.replace(/<\/style/gi, '<\\/style')}</style>`);
  if (settings.custom_head) tags.push(withNonce(settings.custom_head, nonce));
  if (extra) tags.push(extra);
  return tags.join('\n');
}

function buildFooter(settings: Settings, extra = '', nonce = ''): string {
  const parts: string[] = [];
  if (settings.custom_footer) parts.push(withNonce(settings.custom_footer, nonce));
  if (extra) parts.push(withNonce(extra, nonce));
  const widgets = widgetAreas(settings);
  if (widgets) parts.push(widgets);
  if (settings.custom_js) parts.push(`<script${nonce ? ` nonce="${nonce}"` : ''}>${settings.custom_js.replace(/<\/script/gi, '<\\/script')}</script>`);
  return parts.join('\n');
}

/** Adds the response's CSP nonce to inline <script>/<style> tags in admin-authored HTML. */
export function withNonce(fragment: string, nonce: string): string {
  if (!nonce || !fragment) return fragment;
  return fragment
    .replace(/<script(?![^>]*\bnonce=)(?![^>]*\bsrc=)/gi, `<script nonce="${nonce}"`)
    .replace(/<style(?![^>]*\bnonce=)/gi, `<style nonce="${nonce}"`);
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

/** A specific installed theme by slug, for previews. Null when it is not installed. */
export async function themeBySlug(env: Env, slug: string): Promise<ThemeBundle | null> {
  return (await loadTheme(env, { slug }).catch(() => null)) ?? null;
}

export async function renderTheme(
  env: Env,
  opts: {
    cfg: Config; settings: Settings; url: URL; template: string; meta: PageMeta;
    data: Record<string, unknown>;
    /** Render with this theme instead of the active one (admin previews). */
    theme?: ThemeBundle;
    /** Saved values for the theme's declared settings (Appearance screen). */
    themeSettings?: Record<string, string> | null;
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

  const assetUrl = (path: string): string => themeAssetUrl(theme.slug, path.replace(/^\.?\//, ''));
  // Themes installed in the panel have their stylesheet stored as an asset, so a
  // v2 layout can link it (`{{{theme_css_url}}}`) instead of inlining it. The
  // bundled AMS Base has no assets: its CSS is inlined, and every old layout that
  // still asks for `{{{theme_css}}}` keeps working either way.
  const cssUrl = `${assetUrl('style.css')}?v=${encodeURIComponent(theme.version)}`;
  const source = theme.templates[opts.template] ?? theme.templates.page ?? theme.templates.home ?? '';
  const nonce = nonceFor();
  const renderOpts = {
    settings,
    assetUrl,
    themeSettings: opts.themeSettings ?? undefined,
  };
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
    nonce,
    ...opts.data,
  };
  let inner = '';
  try {
    inner = renderWithTheme(theme, source, shared, renderOpts);
    // A theme that does not use {{{comments_html}}} still gets its comments, after the content.
    if (commentsHtml && !/\{\{\{?\s*comments_html\s*\}?\}\}/.test(source)) {
      inner += `\n<div class="comments-fallback">${commentsHtml}</div>`;
    }
    return applyLayout(theme, opts.template, inner, {
      ...shared,
      content: inner,
      theme_css: theme.css.replace(/<\/style/gi, '<\\/style'),
      theme_css_url: cssUrl,
      head: buildHead(opts.meta, settings, url.origin, hooks.head.join('\n'), nonce),
      footer: buildFooter(settings, hooks.footer.join('\n'), nonce),
    }, renderOpts);
  } catch (err) {
    // A theme that throws must not take the site down: render the bundled theme
    // and tell the admins (the banner is rendered by the panel, not here).
    console.error('theme render failed', theme.slug, err);
    markThemeFailure(theme.slug, err);
    const fallbackCss = defaultTheme.css.replace(/<\/style/gi, '<\\/style');
    const safeInner = source ? renderWithTheme(defaultTheme, source, shared, { ...renderOpts, settings }).replace(/\{\{[\s\S]*?\}\}/g, '') : '';
    return applyLayout(defaultTheme, opts.template, safeInner || inner || '', {
      ...shared,
      content: safeInner,
      theme_css: fallbackCss,
      theme_css_url: '',
      head: buildHead(opts.meta, settings, url.origin, hooks.head.join('\n'), nonce),
      footer: buildFooter(settings, hooks.footer.join('\n'), nonce),
    }, { ...renderOpts, settings });
  }
}

/**
 * Rendering failures are remembered per isolate so the Themes screen can show
 * "this theme failed, the site is falling back to AMS Base".
 */
const themeFailures = new Map<string, { at: string; message: string }>();
export function markThemeFailure(slug: string, err: unknown): void {
  themeFailures.set(slug, { at: new Date().toISOString(), message: String(err instanceof Error ? err.message : err).slice(0, 300) });
}
export function themeFailureFor(slug: string): { at: string; message: string } | null {
  return themeFailures.get(slug) ?? null;
}

/* --------------------------------------------------------------- page cache */

export const cacheKey = (cfg: Config, url: URL): string => `page:${cfg.cacheV}:${url.host}:${url.pathname}`;
export const PAGE_CACHE_TTL = 60 * 60 * 24;
