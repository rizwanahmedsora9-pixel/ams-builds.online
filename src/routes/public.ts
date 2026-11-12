import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv, Ctx, Env } from '../types';
import { SESSION_COOKIE, sessionUser } from '../lib/auth';
import { bumpCache, cfgFor, getConfig, getSettings, type Settings } from '../lib/config';
import { findContent, listPosts, permalinkStyle, postUrl, toViews, type ContentView } from '../lib/content';
import { commentsEnabled, commentsModerated, validCommentToken } from '../lib/comments';
import { getFile } from '../lib/files';
import { pluginOn } from '../lib/plugins';
import { PAGE_CACHE_TTL, activeTheme, cacheKey, renderTheme, themeBySlug, type PageMeta } from '../lib/render';
import { resolveSettings } from '../lib/theme-manifest';
import type { ThemeBundle } from '../lib/theme-manifest';
import { clientIp, cspFor, rateCount, rateHit, sameOrigin, stripTags, type CspMode } from '../lib/security';
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
  | { status: 200 | 404; template: string; meta: PageMeta; data: Record<string, unknown> };

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
    return {
      status: 200, template: 'home',
      meta: {
        title: page?.seo_title || (settings.tagline ? `${siteTitle} – ${settings.tagline}` : siteTitle),
        description: page?.seo_description || settings.tagline || undefined, canonical: '/',
      },
      data: { page: page ?? null, posts: await toViews(env, rows, settings), is_home: true },
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
      return { status: 200, template: 'page', meta: metaFor(page, settings, 'website'), data: { page } };
    }
  }

  const postPattern = style === 'plain' ? `^/(${SLUG})$` : style === 'dated' ? `^/\\d{4}/\\d{2}/(${SLUG})$` : `^/blog/(${SLUG})$`;
  if ((m = path.match(new RegExp(postPattern)))) {
    const row = await findContent(env, { type: 'post', slug: m[1] }, preview);
    if (row) {
      const canonical = postUrl(row, style);
      if (canonical !== path) return { redirect: canonical };
      const [post] = await toViews(env, [row], settings);
      return { status: 200, template: 'post', meta: metaFor(post, settings, 'article'), data: { post } };
    }
  }
  return notFound(siteTitle);
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
  const { results } = await c.env.DB.prepare(
    "SELECT slug, title, excerpt, body, published_at, created_at FROM content WHERE site_id=1 AND type='post' AND status='published' ORDER BY published_at DESC LIMIT 20",
  ).all<{ slug: string; title: string; excerpt: string; body: string; published_at: string | null; created_at: string }>();
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
  let previewTheme: ThemeBundle | undefined;
  const wantedTheme = url.searchParams.get('theme');
  if (preview && wantedTheme) previewTheme = (await themeBySlug(c.env, wantedTheme.slice(0, 60))) ?? undefined;
  const cacheable = !hasSession && path.length <= 200 && !url.searchParams.has('comment') && !url.searchParams.has('reply_to');
  const key = cacheKey(c.var.cfg, url);
  const headers = { 'Cache-Control': hasSession ? 'private, no-store' : 'public, max-age=0, must-revalidate' };

  const settings = await getSettings(c.env);
  if (cacheable) {
    const hit = await c.env.KV.get(key);
    if (hit !== null) {
      // A cached page still needs its policy. The nonce is the one baked into the
      // cached HTML, so it rotates with the page (an hour at most) rather than
      // per request — long enough to matter only if someone can read the cache.
      return c.html(hit, 200, { ...headers, 'X-Cache': 'HIT', ...cspHeaders(settings, hit) });
    }
  }

  // Theme settings are read per request (they are one small table) so a change in
  // the panel is visible on the next page load, not the next cache generation.
  const activeSlug = preview ? undefined : await activeThemeSlug(c.env);
  const themeSettings = activeSlug ? await themeValues(c.env, activeSlug) : null;
  const result = await resolve(c, settings, path, preview);
  if ('redirect' in result) return preview ? c.redirect(result.redirect + '?preview=1', 302) : c.redirect(result.redirect, 301);
  if (preview) result.meta.noindex = true;

  const body = await renderTheme(c.env, {
    cfg: c.var.cfg,
    settings,
    url,
    template: result.template,
    meta: result.meta,
    theme: previewTheme,
    themeSettings: previewTheme ? await themeValues(c.env, previewTheme.slug) : themeSettings,
    data: {
      ...result.data,
      comment_notice: url.searchParams.get('comment') || undefined,
      reply_to: url.searchParams.get('reply_to') || undefined,
    },
  });
  if (cacheable && result.status === 200) {
    c.executionCtx.waitUntil(c.env.KV.put(key, body, { expirationTtl: PAGE_CACHE_TTL }));
  }
  // Content-Security-Policy: a per-response nonce, so the site's own custom
  // JS/CSS (which the renderer stamps with it) keeps working while nothing else
  // inline can run. `report` is the safe first step after upgrading.
  return c.html(body, result.status, { ...headers, 'X-Cache': 'MISS', ...cspHeaders(settings, body) });
});

site.all('*', (c) => c.text('Method not allowed', 405));

/* --------------------------------------------------------------- helpers */

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
