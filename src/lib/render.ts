import { SOCIAL_PROFILES, socialUrl } from './social';
import type { Config, Env } from '../types';
import type { Settings } from './config';
import { commentToken, commentsEnabled, approvedComments, renderCommentsHtml, type CommentRow } from './comments';
import { esc, safeUrl } from './security';
import { listPages, type ContentView } from './content';
import { publicPageIcon } from '../admin/icons';
import { type PublicPageHierarchy } from './page-hierarchy';
import { defaultTheme } from '../themes/ams1';
import type { ThemeBundle } from './theme-manifest';
import { activeThemeFor, applyLayout, loadTheme, renderWithTheme, themeAssetUrl } from './theme-store';
import { variablesFor } from './tokens';
import { DEFAULT_WIDGET_AREAS, widgetKey } from './theme-manifest';
import { cspFor, nonceFor } from './security';
import { verificationTags } from './plugins';
import { readTokens, supportedTokens, tokensCss, schemeMeta } from './tokens';

export type { ThemeBundle } from './theme-manifest';

/** Kept for callers that only need the engine: the v2 implementation. */
export { render as renderTemplate } from './template';
export { render as renderTemplateHooks } from './template';

/* -------------------------------------------------------------------- theme */

/** The active theme, merged with its parent; the bundled theme when there is none. */
/** The active theme, or the bundled one: see theme-store's activeThemeFor. */
export const activeTheme = activeThemeFor;

type MenuItem = { label: string; url: string; active: boolean };

async function loadMenus(env: Env, path: string): Promise<Record<string, MenuItem[]>> {
  const { results } = await env.DB.prepare(
    "SELECT m.location, i.label, i.url FROM menus m JOIN menu_items i ON i.menu_id=m.id WHERE m.site_id=1 AND m.location<>'' ORDER BY i.position, i.id",
  ).all<{ location: string; label: string; url: string }>();
  const out: Record<string, MenuItem[]> = {};
  for (const r of results) (out[r.location] ||= []).push({ label: r.label, url: r.url, active: r.url === path });
  return out;
}

const PAGE_HIERARCHY_CSS = `
.page-breadcrumbs{margin:0 0 1.25rem;font-size:.92em}
.page-breadcrumbs ol{display:flex;flex-wrap:wrap;gap:.4rem;list-style:none;margin:0;padding:0}
.page-breadcrumbs li+li:before{content:"/";margin-right:.4rem;opacity:.65}
.page-breadcrumbs a{color:inherit;text-underline-offset:.15em}
.page-children{margin:2.5rem 0 0}
.page-children h2{margin:0 0 1rem;font-size:1.3em}
.page-children ul{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;list-style:none;margin:0;padding:0}
.page-children li{min-width:0}
.page-children a{display:flex;flex-direction:column;height:100%;overflow:hidden;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:.65rem;color:inherit;text-decoration:none;box-shadow:0 2px 8px #0000000a;transition:box-shadow .15s,border-color .15s}
.page-children a:hover,.page-children a:focus-visible{border-color:currentColor;box-shadow:0 5px 16px #00000018}
.page-children__image,.page-children__fallback{display:block;width:100%;aspect-ratio:16/9}
.page-children__image{object-fit:cover}
.page-children__image[hidden]{display:none}
.page-children__fallback{display:grid;place-items:center;background:color-mix(in srgb,currentColor 7%,transparent)}
.page-children__fallback[hidden]{display:none}
.page-children__fallback svg{width:2rem;height:2rem;opacity:.65}
.page-children__body{padding:1rem;display:grid;gap:.4rem}
.page-children__title{font-size:1.08em;font-weight:700;line-height:1.3}
.page-children__description{font-size:.9em;line-height:1.5;opacity:.8}
@media(max-width:800px){.page-children ul{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:480px){.page-children ul{grid-template-columns:1fr}}
.page-posts{margin:2rem 0 0}
.page-posts h2{margin:0 0 1rem;font-size:1.35em}
.page-posts__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:1rem;list-style:none;margin:0;padding:0}
.page-posts__card{display:flex;flex-direction:column;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:1rem;overflow:hidden}
.page-posts__img{display:block}
.page-posts__img img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
.page-posts__body{display:flex;flex-direction:column;gap:.45rem;padding:clamp(1rem,2.5vw,1.35rem)}
.page-posts__body h3{margin:0;font-size:1.12em;line-height:1.35}
.page-posts__body h3 a{color:inherit;text-decoration:none}
.page-posts__body h3 a:hover,.page-posts__body h3 a:focus-visible{text-decoration:underline;text-underline-offset:.15em}
.page-posts__excerpt{margin:0;font-size:.94em;opacity:.85}
.page-posts__meta{margin:0;font-size:.82em;opacity:.68}
`;

/** Folder-like page links and page-assigned posts, rendered by the CMS so every theme gets them. */
function pageExtrasMarkup(
  hierarchy: PublicPageHierarchy | undefined,
  pagePosts: ContentView[] | undefined,
  templateSource: string,
  pageTitle: string | undefined,
  nonce: string,
): { before: string; after: string; styles: string } {
  const current = hierarchy?.current;
  const ancestors = hierarchy?.ancestors ?? [];
  const children = hierarchy?.children ?? [];
  const drawsPostsItself = /\bpage_posts\b|\b#each\s+posts\b/.test(templateSource);
  const posts = !drawsPostsItself && pagePosts?.length ? pagePosts : [];
  const hasHierarchy = !!current && (ancestors.length > 0 || children.length > 0);
  if (!hasHierarchy && !posts.length) return { before: '', after: '', styles: '' };
  const safeHref = (url: string) => esc(safeUrl(url) || '/');
  let before = '';
  if (current && ancestors.length) {
    const trail = ancestors.some((item) => item.url === '/')
      ? ancestors
      : [{ id: 0, title: 'Home', slug: '', url: '/' }, ...ancestors];
    before = `<nav class="page-breadcrumbs" aria-label="Breadcrumb"><ol>${trail.map((item) => `<li><a href="${safeHref(item.url)}">${esc(item.title)}</a></li>`).join('')}<li aria-current="page">${esc(current.title)}</li></ol></nav>`;
  }
  const afterParts: string[] = [];
  if (current && children.length) {
    afterParts.push(`<nav class="page-children" aria-labelledby="page-children-heading"><h2 id="page-children-heading">Explore ${esc(current.title)}</h2><ul>${children.map((item) => `<li><a href="${safeHref(item.url)}">${item.image ? `<img class="page-children__image" src="${esc(safeUrl(item.image))}" alt="" loading="lazy">` : ''}<span class="page-children__fallback"${item.image ? ' hidden' : ''}>${publicPageIcon(item.icon)}</span><span class="page-children__body"><span class="page-children__title">${esc(item.title)}</span>${item.excerpt ? `<span class="page-children__description">${esc(item.excerpt)}</span>` : ''}</span></a></li>`).join('')}</ul></nav>`);
  }
  if (posts.length) {
    const heading = pageTitle ? `Posts in ${esc(pageTitle)}` : 'Posts on this page';
    const cards = posts.map((post) => {
      const img = post.featured_image ? safeUrl(post.featured_image) : '';
      return `<li class="page-posts__card">${img ? `<a class="page-posts__img" href="${safeHref(post.url)}" tabindex="-1"><img src="${esc(img)}" alt="${esc(post.featured_alt || '')}" loading="lazy"></a>` : ''}<div class="page-posts__body"><h3><a href="${safeHref(post.url)}">${esc(post.title)}</a></h3>${post.excerpt ? `<p class="page-posts__excerpt">${esc(post.excerpt)}</p>` : ''}<p class="page-posts__meta"><time datetime="${esc(post.date_iso)}">${esc(post.date)}</time></p></div></li>`;
    }).join('');
    afterParts.push(`<section class="page-posts wrap" aria-labelledby="page-posts-heading"><h2 id="page-posts-heading">${heading}</h2><ul class="page-posts__grid">${cards}</ul></section>`);
  }
  const fallbackScript = children.some(item => item.image) ? `<script nonce="${esc(nonce)}">document.querySelectorAll('.page-children__image').forEach(function(img){function fallback(){img.hidden=true;img.nextElementSibling.hidden=false}img.addEventListener('error',fallback);if(img.complete&&!img.naturalWidth)fallback()})</script>` : '';
  if (fallbackScript) afterParts.push(fallbackScript);
  const styles = `<style nonce="${esc(nonce)}">${PAGE_HIERARCHY_CSS}</style>`;
  return { before, after: afterParts.join('\n'), styles };
}

export type PageMeta = {
  title: string; // already includes the site name when wanted
  description?: string;
  canonical?: string; // path
  image?: string;
  type?: 'website' | 'article';
  noindex?: boolean;
};

function buildHead(meta: PageMeta, settings: Settings, origin: string, extra = '', nonce = '', tokensCss = '', scheme: string | null = null): string {
  const tags = [`<title>${esc(meta.title)}</title>`];
  if (meta.description) tags.push(`<meta name="description" content="${esc(meta.description)}">`);
  if (meta.noindex) tags.push('<meta name="robots" content="noindex">');
  // Search Console Verification plugin: pasted Google/Bing/Yandex codes, live on every page.
  const verification = verificationTags(settings);
  if (verification) tags.push(verification);
  if (meta.canonical) tags.push(`<link rel="canonical" href="${esc(origin + meta.canonical)}">`);
  tags.push(`<meta property="og:title" content="${esc(meta.title)}">`, `<meta property="og:type" content="${meta.type || 'website'}">`);
  if (meta.description) tags.push(`<meta property="og:description" content="${esc(meta.description)}">`);
  // A page's own featured image wins; the site's Identity image is the fallback,
  // so a shared link always has something to show.
  const social = safeUrl(meta.image || settings.social_image || '');
  if (social) tags.push(`<meta property="og:image" content="${esc(social.startsWith('/') ? origin + social : social)}">`);
  // Identity URLs are admin-managed and already sanitised on save; re-checking
  // here keeps a hand-written `settings` row from putting `javascript:` in <head>.
  const icon = safeUrl(settings.favicon || '');
  if (icon) tags.push(`<link rel="icon" href="${esc(icon)}">`);
  const logo = safeUrl(settings.site_logo || '');
  if (logo) tags.push(`<link rel="preload" as="image" href="${esc(logo)}">`);
  // Admin-only custom code (Settings are writable by admins only), injected raw by design.
  // Feed autodiscovery (the RSS plugin can be switched off under Plugins).
  if (settings.plugin_rss !== '0') tags.push(`<link rel="alternate" type="application/rss+xml" title="${esc(settings.site_title || 'RSS')}" href="${esc(origin)}/feed.xml">`);
  // Admin-authored CSS/JS carry the per-response CSP nonce, so the Content-Security-Policy
  // can be strict without breaking the site's own customisations.
  if (settings.custom_css) tags.push(`<style${nonce ? ` nonce="${nonce}"` : ''}>${settings.custom_css.replace(/<\/style/gi, '<\\/style')}</style>`);
  // A site that forces a colour scheme also says so in <head>, so the browser's own
  // widgets (scrollbars, form controls) agree with the page. `scheme` carries an
  // unsaved Customizer value when there is one.
  if (scheme) tags.push(`<meta name="color-scheme" content="${scheme}">`);
  if (tokensCss) tags.push(`<style${nonce ? ` nonce="${nonce}"` : ''} id="site-tokens">${tokensCss}</style>`);
  if (settings.custom_head) tags.push(withNonce(settings.custom_head, nonce));
  if (extra) tags.push(extra);
  return tags.join('\n');
}

function buildFooter(settings: Settings, theme: ThemeBundle, extra = '', nonce = ''): string {
  const parts: string[] = [];
  if (settings.custom_footer) parts.push(withNonce(settings.custom_footer, nonce));
  if (extra) parts.push(withNonce(extra, nonce));
  const widgets = allWidgets(settings, theme);
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

/**
 * Widgets, by area (Admin -> Appearance -> Widgets). A theme draws an area with
 * `{{{widgets.footer}}}`; an area it does not draw arrives with `{{{footer}}}`,
 * so a filled area is never invisible and a drawn one is never repeated.
 *
 * Three slots per area, kept as flat `settings` keys so a page render needs no
 * join. Titles are escaped, bodies are admin-authored HTML (the same trust level
 * as the Custom code boxes).
 */
const WIDGET_SLOTS = 3;

export function widgetAreaHtml(settings: Settings, area: string): string {
  const slots: string[] = [];
  for (let n = 1; n <= WIDGET_SLOTS; n++) {
    const body = (settings[widgetKey(area, n, 'body')] || '').trim();
    if (!body) continue;
    const title = (settings[widgetKey(area, n, 'title')] || '').trim();
    slots.push(`<div class="widget site-widget widget--${esc(area)}">${title ? `<h2 class="widget-title">${esc(title)}</h2>` : ''}${body}</div>`);
  }
  return slots.length ? `<div class="site-widgets site-widgets--${esc(area)}"><div class="wrap"><div class="site-widgets-grid">${slots.join('')}</div></div></div>` : '';
}

/** Every area a theme offers, in manifest order. */
const themeAreas = (theme: ThemeBundle) => (theme.manifest.widgets?.length ? theme.manifest.widgets : DEFAULT_WIDGET_AREAS);

/**
 * The areas the theme's layout draws itself, with `{{{widgets.footer}}}` or
 * `{{{widgets["footer"]}}}`. Those are placed by the theme; the rest are
 * appended after the footer so a new area is never silently invisible.
 */
function drawnAreas(theme: ThemeBundle): Set<string> {
  const layout = theme.templates[theme.manifest.layout || 'base'] ?? theme.templates.base ?? '';
  const drawn = new Set<string>();
  for (const area of themeAreas(theme)) {
    const key = area.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`widgets\\.${key}\\b|widgets\\[["']${key}["']\\]`).test(layout)) drawn.add(area.key);
  }
  return drawn;
}

/** The areas the theme did not place itself, so nothing an editor fills is lost. */
function allWidgets(settings: Settings, theme: ThemeBundle): string {
  const drawn = drawnAreas(theme);
  return themeAreas(theme)
    .filter((area) => !drawn.has(area.key))
    .map((area) => widgetAreaHtml(settings, area.key))
    .filter(Boolean)
    .join('\n');
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
    /** Token overrides from an unsaved Customizer preview (signed cookie). */
    tokenOverrides?: Record<string, string>;
    /** Parent/child navigation for a public CMS Page. */
    pageHierarchy?: PublicPageHierarchy;
    /** Posts targeted exclusively to this CMS Page. */
    pagePosts?: ContentView[];
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
  // bundled copy of AMS 1 (used before an install has written its row) has no
  // asset to link: its CSS is inlined, and every layout that asks for
  // `{{{theme_css}}}` keeps working either way.
  const cssUrl = `${assetUrl('style.css')}?v=${encodeURIComponent(theme.version)}`;
  // A per-item template (content.template) is resolved by the caller into
  // `opts.template`; when the current theme has no such template the default
  // one for the kind is used, so switching theme never blanks a page.
  const source = theme.templates[opts.template]
    ?? (opts.template === 'search' ? theme.templates.archive : undefined)
    ?? theme.templates.page ?? theme.templates.home ?? '';
  const nonce = nonceFor();
  const pageData = opts.data.page as { title?: string } | null | undefined;
  const hierarchyMarkup = pageExtrasMarkup(opts.pageHierarchy, opts.pagePosts, source, pageData?.title, nonce);
  const headExtra = [hooks.head.join('\n'), hierarchyMarkup.styles].filter(Boolean).join('\n');
  // Design tokens: only the variables this theme actually reads are emitted, so
  // changing a brand colour cannot break a theme that hard-codes its palette.
  const tokenValues = { ...readTokens(settings), ...(opts.tokenOverrides ?? {}) };
  const only = new Set<string>();
  for (const field of supportedTokens(theme.css)) {
    for (const name of variablesFor(field.key)) only.add(name);
  }
  const tokensBlock = tokensCss(tokenValues, { only });
  // The scheme can be changed in the Customizer before it is saved, so it comes
  // from the merged values rather than from `settings` alone.
  const scheme = schemeMeta(tokenValues.token_scheme);
  // A theme may place an area exactly where it wants: `{{{widgets.footer}}}`.
  const widgetMap: Record<string, string> = {};
  for (const area of themeAreas(theme)) widgetMap[area.key] = widgetAreaHtml(settings, area.key);
  const renderOpts = {
    settings,
    assetUrl,
    themeSettings: opts.themeSettings ?? undefined,
  };
  const shared = {
    site: {
      title: settings.site_title || '', tagline: settings.tagline || '', url: url.origin,
      social: SOCIAL_PROFILES.map(([key, label]) => ({ name: key, label, url: socialUrl(settings['social_' + key] || '') })).filter((profile) => profile.url),
      social_footer: settings.social_footer === '1',
      // Identity images, so a theme can draw the logo instead of the title
      // (`{{#if site.logo}}<img src="{{site.logo}}" alt="{{site.title}}">{{/if}}`).
      logo: safeUrl(settings.site_logo || ''), social_image: safeUrl(settings.social_image || ''), favicon: safeUrl(settings.favicon || ''),
    },
    // Design tokens as data, for a theme that wants to compute from them.
    tokens: tokenValues,
    scheme: scheme ?? 'auto',
    // Widgets: the areas the theme draws with `{{{widgets.footer}}}`, and the
    // list of area keys for a theme that wants to render its own wrapper.
    widgets: widgetMap,
    widget_areas: themeAreas(theme).map((a) => a.key),
    menu,
    // {{#each pages}} - every published page in editor order, for a nav of its own.
    pages: pageRows.map((p) => ({
      title: p.title, slug: p.slug, icon: p.icon || '',
      url: settings.home_page_id === String(p.id) ? '/' : '/' + p.slug,
      // The template the editor picked for this page, so a theme can build a
      // list of one kind of page (a Tools index of the pages laid out as tools):
      // `{{#if template eq "tool"}}`. Empty means the kind's default template.
      template: p.template || '',
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
    const pageContent = `${hierarchyMarkup.before}${inner}${hierarchyMarkup.after}`;
    return applyLayout(theme, opts.template, pageContent, {
      ...shared,
      content: pageContent,
      theme_css: theme.css.replace(/<\/style/gi, '<\\/style'),
      theme_css_url: cssUrl,
      tokens_css: tokensBlock,
      // The site's own tokens go *after* the theme stylesheet so they win, but
      // before custom CSS so an author's final say still has the last word.
      head: buildHead(opts.meta, settings, url.origin, headExtra, nonce, tokensBlock, scheme),
      footer: buildFooter(settings, theme, hooks.footer.join('\n'), nonce),
    }, renderOpts);
  } catch (err) {
    // A theme that throws must not take the site down: render the bundled theme
    // and tell the admins (the banner is rendered by the panel, not here).
    console.error('theme render failed', theme.slug, err);
    markThemeFailure(theme.slug, err);
    const fallbackCss = defaultTheme.css.replace(/<\/style/gi, '<\\/style');
    const safeInner = source ? renderWithTheme(defaultTheme, source, shared, { ...renderOpts, settings }).replace(/\{\{[\s\S]*?\}\}/g, '') : '';
    const fallbackContent = `${hierarchyMarkup.before}${safeInner || inner || ''}${hierarchyMarkup.after}`;
    return applyLayout(defaultTheme, opts.template, fallbackContent, {
      ...shared,
      content: fallbackContent,
      theme_css: fallbackCss,
      theme_css_url: '',
      tokens_css: tokensBlock,
      // The site's own tokens go *after* the theme stylesheet so they win, but
      // before custom CSS so an author's final say still has the last word.
      head: buildHead(opts.meta, settings, url.origin, headExtra, nonce, tokensBlock, scheme),
      footer: buildFooter(settings, theme, hooks.footer.join('\n'), nonce),
    }, { ...renderOpts, settings });
  }
}

/**
 * Rendering failures are remembered per isolate so the Themes screen can show
 * "this theme failed, the site is falling back to AMS 1".
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
