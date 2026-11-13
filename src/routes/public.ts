import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv, Ctx, Env } from '../types';
import { SESSION_COOKIE, sessionUser } from '../lib/auth';
import { bumpCache, cfgFor, getConfig, getSettings, type Settings } from '../lib/config';
import { findContent, listPosts, mediaUrl, permalinkStyle, postAssignedPages, postUrl, toViews, type ContentView } from '../lib/content';
import { hasTable } from '../lib/schema';
import { commentsEnabled, commentsModerated, validCommentToken } from '../lib/comments';
import { getFile } from '../lib/files';
import { pluginOn } from '../lib/plugins';
import { PAGE_CACHE_TTL, activeTheme, cacheKey, renderTheme, themeBySlug, type PageMeta } from '../lib/render';
import { resolveSettings } from '../lib/theme-manifest';
import { previewFor } from '../lib/preview';
import { can } from '../lib/capabilities';
import type { ThemeBundle } from '../lib/theme-manifest';
import { clientIp, cspFor, nonceFor, rateCount, rateHit, safeUrl, sameOrigin, stripTags, type CspMode } from '../lib/security';
import { landingEnabled, landingPlayShown, landingScreenMarkup, parseLandingAudioIds, type LandingAudioTrack } from '../lib/landing';
import { titleFor } from '../lib/origin';
import { publicPageHierarchy, type PublicPageHierarchy } from '../lib/page-hierarchy';
import { getThemeAsset, loadTheme, putThemeAsset } from '../lib/theme-store';
import { assetMime, cleanAssetPath, isRefusedAsset } from '../lib/theme-manifest';

const site = new Hono<AppEnv>();

site.use('*', async (c, next) => {
  c.set('cfg', cfgFor.get(c.req.raw) ?? (await getConfig(c.env)));
  await next();
});

/* -------------------------------------------------------------- uploaded media */
site.get('/media/*', async (c) => {
  let key: string;
  try {
    key = decodeURIComponent(new URL(c.req.url).pathname.slice('/media/'.length));
  } catch {
    return c.notFound();
  }
  if (!key || key.startsWith('backups/')) return c.notFound();
  const file = await getFile(c.env, key);
  if (!file) return c.notFound();
  const etag = `"${file.etag}"`;
  const headers = new Headers({
    'Content-Type': file.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    // Uploaded files may never run script in the site's origin (matters for SVG/HTML-ish files).
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src 'self'; sandbox",
    ETag: etag,
  });
  if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(file.body, { headers });
});

/* ----------------------------------------------------------- theme assets */
/**
 * Theme packages ship images, fonts and an optional `theme.js`. They are served
 * from this origin, so the response is locked down the same way media is:
 * `nosniff`, an immutable cache, and a sandbox CSP (a JS asset cannot touch the
 * page; a page that loads it does so with `defer`, as a plain script).
 */
site.get('/theme-assets/:slug/:path{.+}', async (c) => {
  const slug = c.req.param('slug');
  const raw = c.req.param('path');
  const path = cleanAssetPath(raw);
  if (!path || isRefusedAsset(path)) return c.notFound();
  const file = await getThemeAsset(c.env, slug, path);
  if (!file) return c.notFound();
  const etag = `"${file.etag}"`;
  const headers = new Headers({
    'Content-Type': file.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src 'self'; sandbox",
    ETag: etag,
  });
  if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(file.body, { headers });
});

/* ------------------------------------------------------------------ pages */
type Resolved =
  | { redirect: string }
  | { status: 200 | 404; template: string; meta: PageMeta; data: Record<string, unknown>; pageHierarchy?: PublicPageHierarchy; pagePosts?: ContentView[] };

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';

function metaFor(v: ContentView, settings: Settings, type: 'website' | 'article'): PageMeta {
  return {
    title: v.seo_title || `${v.title} – ${settings.site_title || ''}`,
    description: v.seo_description || v.excerpt,
    canonical: v.url,
    image: v.featured_image || undefined,
    type,
    noindex: v.status === 'draft',
  };
}

async function resolve(c: Ctx, settings: Settings, path: string, preview: boolean): Promise<Resolved> {
  const env = c.env;
  const siteTitle = settings.site_title || '';
  const perPage = Math.min(50, Math.max(1, Number(settings.posts_per_page) || 10));
  const style = permalinkStyle(settings);
  const homeId = Number(settings.home_page_id) || 0;
  let m: RegExpMatchArray | null;

  if (path === '/') {
    const row = homeId ? await findContent(env, { type: 'page', id: homeId }, preview) : null;
    const [page] = row ? await toViews(env, [row], settings) : [];
    const { rows } = await listPosts(env, { page: 1, perPage: 5 });
    const homePagePosts = row ? await toViews(env, (await listPosts(env, { page: 1, perPage: 100, pageId: row.id })).rows, settings) : [];
    return {
      status: 200, template: row ? templateFor(row, 'home') : 'home',
      meta: {
        title: page?.seo_title || (settings.tagline ? `${siteTitle} – ${settings.tagline}` : siteTitle),
        description: page?.seo_description || settings.tagline || undefined, canonical: '/',
      },
      data: { page: page ?? null, posts: await toViews(env, rows, settings), page_posts: homePagePosts, is_home: true },
      pageHierarchy: row ? await publicPageHierarchy(env, row.id, settings.home_page_id) : undefined,
      pagePosts: homePagePosts.length ? homePagePosts : undefined,
    };
  }

  // Blog index and category/tag archives, with /page/N pagination.
  if ((m = path.match(new RegExp(`^/(?:blog|(category|tag)/(${SLUG}))(?:/page/(\\d{1,4}))?$`)))) {
    const pageNo = Math.max(1, Number(m[3]) || 1);
    const basePath = m[1] ? `/${m[1]}/${m[2]}` : '/blog';
    let title = 'Blog';
    let termId: number | undefined;
    if (m[1]) {
      const term = await env.DB.prepare('SELECT id, name FROM terms WHERE site_id=1 AND taxonomy=? AND slug=?').bind(m[1], m[2]).first<{ id: number; name: string }>();
      if (!term) return notFound(siteTitle);
      termId = term.id;
      title = (m[1] === 'tag' ? '#' : '') + term.name;
    }
    const { rows, total } = await listPosts(env, { page: pageNo, perPage, termId });
    if (pageNo > 1 && !rows.length) return notFound(siteTitle);
    return {
      status: 200, template: 'archive',
      meta: { title: `${title}${pageNo > 1 ? ` (page ${pageNo})` : ''} – ${siteTitle}`, canonical: pageNo > 1 ? `${basePath}/page/${pageNo}` : basePath },
      data: {
        archive: { title, type: m[1] || 'blog' },
        posts: await toViews(env, rows, settings),
        pagination: {
          page: pageNo, pages: Math.max(1, Math.ceil(total / perPage)),
          prev: pageNo > 1 ? (pageNo === 2 ? basePath : `${basePath}/page/${pageNo - 1}`) : null,
          next: pageNo * perPage < total ? `${basePath}/page/${pageNo + 1}` : null,
        },
      },
    };
  }

  // Pages live at /{slug} and win over posts when the "plain" permalink style is used.
  if ((m = path.match(new RegExp(`^/(${SLUG})$`)))) {
    const row = await findContent(env, { type: 'page', slug: m[1] }, preview);
    if (row) {
      if (row.id === homeId) return { redirect: '/' };
      const [page] = await toViews(env, [row], settings);
      const { rows: assignedRows } = await listPosts(env, { page: 1, perPage: 100, pageId: row.id });
      const pagePosts = await toViews(env, assignedRows, settings);
      return {
        status: 200, template: templateFor(row, 'page'), meta: metaFor(page, settings, 'website'),
        data: { page, posts: pagePosts, page_posts: pagePosts },
        pageHierarchy: await publicPageHierarchy(env, row.id, settings.home_page_id),
        pagePosts: pagePosts.length ? pagePosts : undefined,
      };
    }
  }

  const postPattern = style === 'plain' ? `^/(${SLUG})$` : style === 'dated' ? `^/\\d{4}/\\d\\d/(${SLUG})$` : `^/blog/(${SLUG})$`;
  if ((m = path.match(new RegExp(postPattern)))) {
    const row = await findContent(env, { type: 'post', slug: m[1] }, preview);
    if (row) {
      const canonical = postUrl(row, style);
      if (canonical !== path) return { redirect: canonical };
      const [post] = await toViews(env, [row], settings);
      const assignedPages = await postAssignedPages(env, row.id, settings.home_page_id);
      return {
        status: 200, template: templateFor(row, 'post'), meta: metaFor(post, settings, 'article'),
        data: { post: { ...post, pages: assignedPages }, post_pages: assignedPages },
      };
    }
  }
  return notFound(siteTitle);
}

/**
 * A page or post may name the theme template that renders it (the editor's
 * Template dropdown, `content.template`). The name is stored only after it
 * matched a template the active theme had, and renderTheme falls back to the
 * default template when the current theme does not have it, so a theme switch
 * cannot leave a page with no template.
 */
function templateFor(row: { template?: string | null }, fallback: string): string {
  const wanted = (row.template || '').trim();
  return /^[a-z][a-z0-9-]{1,30}$/.test(wanted) ? wanted : fallback;
}

const notFound = (siteTitle: string): Resolved => ({
  status: 404, template: '404', meta: { title: `Page not found – ${siteTitle}`, noindex: true }, data: {},
});

/* --------------------------------------------------------------- comments */
// Public comment form. Protected by a signed form token, an origin check, a
// honeypot field and a per-IP rate limit; new comments wait for moderation
// unless an admin turns that off in Settings -> Discussion.
site.post('/comments', async (c) => {
  if (!sameOrigin(c.req.raw)) return c.text('Bad origin', 403);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.text('Bad request', 400);
  }
  const settings = await getSettings(c.env);
  const id = Number(form.get('content_id')) || 0;
  const post = id ? await findContent(c.env, { type: 'post', id }) : null;
  if (!post) return c.text('That post no longer accepts comments.', 404);
  const style = permalinkStyle(settings);
  const back = (code: string) => c.redirect(`${postUrl(post, style)}?comment=${code}#comments`, 303);

  if (!commentsEnabled(settings)) return back('closed');
  if (String(form.get('website') ?? '').trim()) return back('failed'); // honeypot
  if (!(await validCommentToken(c.var.cfg.secret, post.id, String(form.get('token') ?? '')))) return back('failed');

  const ip = clientIp(c.req.raw);
  const rlKey = 'comment:' + ip;
  if ((await rateCount(c.env, rlKey)) >= 5) return back('rate');

  const name = String(form.get('name') ?? '').trim().slice(0, 80);
  const email = String(form.get('email') ?? '').trim().slice(0, 160);
  const body = String(form.get('body') ?? '').trim().slice(0, 4000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || body.length < 2) return back('invalid');

  // Replies only attach to an approved comment on the same post.
  let parentId: number | null = null;
  const wantedParent = Number(form.get('parent_id')) || 0;
  if (wantedParent) {
    const parent = await c.env.DB.prepare("SELECT id FROM comments WHERE id=? AND site_id=1 AND content_id=? AND status='approved'")
      .bind(wantedParent, post.id).first<{ id: number }>();
    if (parent) parentId = parent.id;
  }

  const status = commentsModerated(settings) ? 'pending' : 'approved';
  const now = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      'INSERT INTO comments (site_id,content_id,parent_id,author_name,author_email,body,status,ip,user_agent,created_at,updated_at) VALUES (1,?,?,?,?,?,?,?,?,?,?)',
    ).bind(post.id, parentId, name, email, body, status, ip, (c.req.header('user-agent') || '').slice(0, 200), now, now).run();
  } catch {
    return back('failed');
  }
  await rateHit(c.env, rlKey, 10 * 60);
  if (status === 'approved') await bumpCache(c.env, c.var.cfg);
  return back(status === 'approved' ? 'published' : 'pending');
});

/* ---------------------------------------------- sitemap, robots, RSS feed */
const xmlEsc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);

site.get('/sitemap.xml', async (c) => {
  const settings = await getSettings(c.env);
  if (!pluginOn(settings, 'sitemap')) return c.notFound();
  const origin = new URL(c.req.url).origin;
  const style = permalinkStyle(settings);
  const homeId = Number(settings.home_page_id) || 0;
  const [{ results: content }, { results: terms }] = await Promise.all([
    c.env.DB.prepare("SELECT id, type, slug, published_at, created_at, updated_at FROM content WHERE site_id=1 AND status='published' ORDER BY updated_at DESC")
      .all<{ id: number; type: string; slug: string; published_at: string | null; created_at: string; updated_at: string }>(),
    c.env.DB.prepare('SELECT taxonomy, slug, name FROM terms WHERE site_id=1 ORDER BY name')
      .all<{ taxonomy: string; slug: string; name: string }>(),
  ]);
  const urls: string[] = [];
  const push = (loc: string, lastmod: string, priority: string) => {
    urls.push(`<url><loc>${xmlEsc(origin + loc)}</loc><lastmod>${xmlEsc(lastmod.slice(0, 10))}</lastmod><priority>${priority}</priority></url>`);
  };
  push('/', new Date().toISOString(), '1.0');
  for (const row of content) {
    if (row.type === 'page') {
      if (row.id === homeId) continue;
      push('/' + row.slug, row.updated_at, '0.7');
    } else {
      push(postUrl(row, style), row.updated_at, '0.8');
    }
  }
  for (const t of terms) push(`/${t.taxonomy}/${t.slug}`, new Date().toISOString(), '0.4');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
});

site.get('/robots.txt', async (c) => {
  const settings = await getSettings(c.env);
  if (!pluginOn(settings, 'robots')) return c.notFound();
  const origin = new URL(c.req.url).origin;
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /media/backups/'];
  if (pluginOn(settings, 'sitemap')) lines.push('', `Sitemap: ${origin}/sitemap.xml`);
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
});

site.get('/feed.xml', async (c) => {
  const settings = await getSettings(c.env);
  if (!pluginOn(settings, 'rss')) return c.notFound();
  const hasPostPages = await hasTable(c.env, 'content_pages');
  const queryFeed = (withPostPages: boolean) => {
    const pageFilter = withPostPages ? ' AND NOT EXISTS (SELECT 1 FROM content_pages cp WHERE cp.content_id=content.id)' : '';
    return c.env.DB.prepare(
      `SELECT slug, title, excerpt, body, published_at, created_at FROM content WHERE site_id=1 AND type='post' AND status='published'${pageFilter} ORDER BY published_at DESC LIMIT 20`,
    ).all<{ slug: string; title: string; excerpt: string; body: string; published_at: string | null; created_at: string }>();
  };
  let results;
  try {
    ({ results } = await queryFeed(hasPostPages));
  } catch (err) {
    if (!String(err).toLowerCase().includes('content_pages')) throw err;
    ({ results } = await queryFeed(false));
  }
  const origin = new URL(c.req.url).origin;
  const style = permalinkStyle(settings);
  const items = results.map((p) => {
    const date = p.published_at || p.created_at;
    const plain = (p.excerpt || stripTags(p.body)).slice(0, 400);
    return `<item>
<title>${xmlEsc(p.title)}</title>
<link>${xmlEsc(origin + postUrl(p, style))}</link>
<guid isPermaLink="true">${xmlEsc(origin + postUrl(p, style))}</guid>
<pubDate>${new Date(date).toUTCString()}</pubDate>
<description>${xmlEsc(plain)}</description>
</item>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${xmlEsc(settings.site_title || '')}</title>
<link>${xmlEsc(origin)}</link>
<description>${xmlEsc(settings.tagline || settings.site_title || '')}</description>
<language>en</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.join('\n')}
</channel></rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
});

site.get('/feed', (c) => c.redirect('/feed.xml', 301));

site.get('*', async (c) => {
  const url = new URL(c.req.url);
  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) return c.redirect(path.replace(/\/+$/, '') + url.search, 301);

  // Redirects created under Admin -> Tools -> Redirects.
  try {
    const hit = await c.env.DB.prepare('SELECT to_url, status FROM redirects WHERE site_id=1 AND from_path=?')
      .bind(path).first<{ to_url: string; status: number }>();
    if (hit) return c.redirect(hit.to_url, hit.status === 302 ? 302 : 301);
  } catch {
    /* table missing on an old database */
  }

  // Signed-in users always get fresh pages; ?preview=1 additionally shows drafts
  // to them, and &theme=slug renders the page with any installed theme (the
  // editor's "Preview in theme" menu and the theme store use this).
  const hasSession = !!getCookie(c, SESSION_COOKIE);
  const signedIn = hasSession ? await sessionUser(c, c.var.cfg) : null;
  const preview = hasSession && url.searchParams.has('preview') && !!signedIn;
  // The Customizer's channel: unsaved values live in a signed cookie, never in
  // the query string, and are read only for a signed-in admin.
  const unsaved = preview ? await previewFor(c, !!signedIn && can(signedIn, 'manage_appearance')) : null;
  let previewTheme: ThemeBundle | undefined;
  // `&customize=1` only labels the preview for the Customizer's own script.
  const wantedTheme = url.searchParams.get('theme') ?? unsaved?.theme;
  if (preview && wantedTheme) previewTheme = (await themeBySlug(c.env, wantedTheme.slice(0, 60))) ?? undefined;
  // `?landing=1` re-opens the welcome screen even while its switch is off, so it
  // must render per request: the page cache is keyed by path, not by query, and a
  // cached home response would answer the preview with the stripped-down page.
  const previewLanding = url.searchParams.get('landing') === '1';
  const cacheable = !hasSession && path.length <= 200 && !previewLanding && !url.searchParams.has('comment') && !url.searchParams.has('reply_to');
  const key = cacheKey(c.var.cfg, url);
  const headers = { 'Cache-Control': hasSession ? 'private, no-store' : 'public, max-age=0, must-revalidate' };

  const settings = await getSettings(c.env);
  // A title nobody has renamed follows the domain the page is served from, so the
  // same install (or a second deploy of it) names itself correctly on every host.
  settings.site_title = titleFor(settings.site_title, url);
  if (cacheable) {
    const hit = await c.env.KV.get(key);
    if (hit !== null) {
      // A cached page still needs its policy. The nonce is the one baked into the
      // cached HTML, so it rotates with the page (an hour at most) rather than
      // per request — long enough to matter only if someone can read the cache.
      const cached = c.html(hit, 200, { ...headers, 'X-Cache': 'HIT', ...cspHeaders(settings, hit) });
      if (url.searchParams.has('preview')) frameable(cached);
      return cached;
    }
  }

  // Theme settings are read per request (they are one small table) so a change in
  // the panel is visible on the next page load, not the next cache generation.
  const activeSlug = preview ? undefined : await activeThemeSlug(c.env);
  const themeSettings = activeSlug ? await themeValues(c.env, activeSlug) : null;
  const result = await resolve(c, settings, path, preview);
  if ('redirect' in result) return preview ? c.redirect(result.redirect + '?preview=1', 302) : c.redirect(result.redirect, 301);
  if (preview) result.meta.noindex = true;

  const framed = url.searchParams.has('preview');
  let body = await renderTheme(c.env, {
    cfg: c.var.cfg,
    settings,
    url,
    template: result.template,
    meta: result.meta,
    theme: previewTheme,
    // Unsaved theme settings (a Customizer preview) sit on top of the saved ones.
    themeSettings: unsaved?.settings
      ? { ...(previewTheme ? await themeValues(c.env, previewTheme.slug) : themeSettings ?? {}), ...unsaved.settings }
      : previewTheme ? await themeValues(c.env, previewTheme.slug) : themeSettings,
    tokenOverrides: unsaved?.tokens,
    pageHierarchy: result.pageHierarchy,
    pagePosts: result.pagePosts,
    data: {
      ...result.data,
      comment_notice: url.searchParams.get('comment') || undefined,
      reply_to: url.searchParams.get('reply_to') || undefined,
    },
  });

  // The fixed landing screen is a first-visit layer over the existing home
  // page. It is built from saved settings, never from a CMS Page; the visitor
  // enters the site in-place, so / remains the normal home URL/content.
  // The preview above renders the screen even while the Landing page switch is
  // off, so the admin can check it before turning it on.
  if (path === '/' && result.status === 200 && !preview && (landingEnabled(settings) || previewLanding)) {
    const ids = parseLandingAudioIds(settings.landing_audio_ids);
    let tracks: LandingAudioTrack[] = [];
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const { results: audioRows } = await c.env.DB.prepare(
        `SELECT id, r2_key, filename FROM media WHERE site_id=1 AND mime LIKE 'audio/%' AND id IN (${placeholders})`,
      ).bind(...ids).all<{ id: number; r2_key: string; filename: string }>();
      const byId = new Map(audioRows.map((item) => [item.id, item]));
      tracks = ids.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => !!item)
        .map((item) => ({ id: item.id, url: mediaUrl(item.r2_key), filename: item.filename }));
    }
    const nonce = body.match(/<(?:script|style)\b[^>]*\bnonce="([^"]+)"/i)?.[1] || nonceFor();
    const markup = landingScreenMarkup({
      siteTitle: settings.site_title || '',
      tagline: settings.tagline || '',
      logoUrl: safeUrl(settings.site_logo || ''),
      tracks,
      showPlay: landingPlayShown(settings),
      nonce,
    });
    body = injectLandingScreen(body, markup);
  }

  if (cacheable && result.status === 200) {
    c.executionCtx.waitUntil(c.env.KV.put(key, body, { expirationTtl: PAGE_CACHE_TTL }));
  }
  // Content-Security-Policy: a per-response nonce, so the site's own custom
  // JS/CSS (which the renderer stamps with it) keeps working while nothing else
  // inline can run. `report` is the safe first step after upgrading.
  const response = c.html(body, result.status, { ...headers, 'X-Cache': 'MISS', ...cspHeaders(settings, body) });
  if (framed) frameable(response);
  return response;
});

site.all('*', (c) => c.text('Method not allowed', 405));

/* --------------------------------------------------------------- helpers */

/** Put the first-visit splash in the document head/body without replacing the theme's home page. */
function injectLandingScreen(pageHtml: string, markup: { head: string; body: string }): string {
  const withHead = /<\/head>/i.test(pageHtml)
    ? pageHtml.replace(/<\/head>/i, () => `${markup.head}</head>`)
    : pageHtml;
  return /<\/body>/i.test(withHead)
    ? withHead.replace(/<\/body>/i, () => `${markup.body}</body>`)
    : withHead + markup.body;
}

/**
 * A `?preview=1` page is shown in the Customizer's iframe, so it may be framed
 * by this site only. The panel keeps its `X-Frame-Options: DENY`; the public
 * page it frames relaxes it for itself, and `frame-ancestors` keeps anyone else
 * from framing the site.
 */
function frameable(response: Response): void {
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  const blocking = response.headers.has('Content-Security-Policy');
  const key = blocking ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
  const csp = response.headers.get(key);
  if (csp && !csp.includes('frame-ancestors')) response.headers.set(key, `${csp}; frame-ancestors 'self'`);
}

/**
 * The Content-Security-Policy for one response. The nonce is read out of the
 * rendered HTML (the renderer stamped it on the site's own inline code), so the
 * policy and the page always agree — including when the page came from cache.
 */
function cspHeaders(settings: Settings, html: string): Record<string, string> {
  const nonce = html.match(/<(?:script|style) nonce="([^"]+)"/)?.[1] ?? '';
  const csp = cspFor({ mode: cspMode(settings), nonce });
  return csp ? { [csp.header]: csp.value } : {};
}

/** `csp` setting: off | report | enforce (default report, so nothing breaks silently). */
function cspMode(settings: Settings): CspMode {
  const value = (settings.csp || '').toLowerCase();
  return value === 'off' || value === 'enforce' ? (value as CspMode) : 'report';
}

async function activeThemeSlug(env: Env): Promise<string | null> {
  try {
    const row = await env.DB.prepare('SELECT slug FROM themes WHERE active=1 LIMIT 1').first<{ slug: string }>();
    return row?.slug ?? null;
  } catch {
    return null;
  }
}

/**
 * Saved theme settings merged over the theme's declared defaults. Cached for a
 * few seconds per isolate: it is read on every page render, and a stale default
 * for 5 s cannot hurt.
 */
export const themeValueCache = new WeakMap<object, { at: number; bySlug: Map<string, Record<string, string>> }>();

/** Called when theme settings change, so the next page render sees the new values. */
export function clearThemeValueCache(env: Env): void {
  themeValueCache.delete(env);
}
async function themeValues(env: Env, slug: string): Promise<Record<string, string>> {
  const now = Date.now();
  let entry = themeValueCache.get(env);
  if (!entry || now - entry.at > 5_000) {
    entry = { at: now, bySlug: new Map() };
    themeValueCache.set(env, entry);
  }
  const hit = entry.bySlug.get(slug);
  if (hit) return hit;
  let out: Record<string, string> = {};
  try {
    const theme = await loadTheme(env, { slug });
    const { results } = await env.DB.prepare('SELECT key, value FROM theme_settings WHERE theme_slug=?')
      .bind(slug).all<{ key: string; value: string }>();
    const saved: Record<string, string> = {};
    for (const r of results) saved[r.key] = r.value;
    out = theme ? resolveSettings(theme.manifest, saved) : saved;
  } catch {
    /* no theme settings table yet */
  }
  entry.bySlug.set(slug, out);
  return out;
}

/** Uploads a theme asset from the panel (theme manager). Exported for tests. */
export async function storeThemeAsset(env: Env, slug: string, path: string, data: ArrayBuffer): Promise<boolean> {
  const mime = assetMime(path);
  if (!mime || isRefusedAsset(path)) return false;
  await putThemeAsset(env, slug, path, data, mime);
  return true;
}

export default site;
