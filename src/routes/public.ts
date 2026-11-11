import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv, Ctx } from '../types';
import { SESSION_COOKIE, sessionUser } from '../lib/auth';
import { cfgFor, getConfig, getSettings, type Settings } from '../lib/config';
import { findContent, listPosts, permalinkStyle, postUrl, toViews, type ContentView } from '../lib/content';
import { PAGE_CACHE_TTL, cacheKey, renderTheme, type PageMeta } from '../lib/render';

const site = new Hono<AppEnv>();

site.use('*', async (c, next) => {
  c.set('cfg', cfgFor.get(c.req.raw) ?? (await getConfig(c.env)));
  await next();
});

/* -------------------------------------------------------------- media (R2) */
site.get('/media/*', async (c) => {
  let key: string;
  try {
    key = decodeURIComponent(new URL(c.req.url).pathname.slice('/media/'.length));
  } catch {
    return c.notFound();
  }
  if (!key || key.startsWith('backups/')) return c.notFound();
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers({
    'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    // Uploaded files may never run script in the site's origin (matters for SVG/HTML-ish files).
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src 'self'; sandbox",
    ETag: obj.httpEtag,
  });
  if (c.req.header('if-none-match') === obj.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
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

site.get('*', async (c) => {
  const url = new URL(c.req.url);
  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) return c.redirect(path.replace(/\/+$/, '') + url.search, 301);

  // Signed-in users always get fresh pages; ?preview=1 additionally shows drafts to them.
  const hasSession = !!getCookie(c, SESSION_COOKIE);
  const preview = hasSession && url.searchParams.has('preview') && !!(await sessionUser(c, c.var.cfg));
  const cacheable = !hasSession && path.length <= 200;
  const key = cacheKey(c.var.cfg, url);
  const headers = { 'Cache-Control': hasSession ? 'private, no-store' : 'public, max-age=0, must-revalidate' };

  if (cacheable) {
    const hit = await c.env.KV.get(key);
    if (hit !== null) return c.html(hit, 200, { ...headers, 'X-Cache': 'HIT' });
  }

  const settings = await getSettings(c.env);
  const result = await resolve(c, settings, path, preview);
  if ('redirect' in result) return preview ? c.redirect(result.redirect + '?preview=1', 302) : c.redirect(result.redirect, 301);
  if (preview) result.meta.noindex = true;

  const body = await renderTheme(c.env, { settings, url, template: result.template, meta: result.meta, data: result.data });
  if (cacheable && result.status === 200) {
    c.executionCtx.waitUntil(c.env.KV.put(key, body, { expirationTtl: PAGE_CACHE_TTL }));
  }
  return c.html(body, result.status, { ...headers, 'X-Cache': 'MISS' });
});

site.all('*', (c) => c.text('Method not allowed', 405));

export default site;
