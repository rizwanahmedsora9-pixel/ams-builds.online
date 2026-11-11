import { Hono } from 'hono';
import type { Env } from '../types';
import { getSettings } from '../lib/config';
import { findContent, listPosts, toViews } from '../lib/content';

/** Read-only public JSON API (published content only). */
const api = new Hono<{ Bindings: Env }>();

api.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'public, max-age=60');
});

/** Read-only self-check of the three storage backends. Works before and after install. */
api.get('/health', async (c) => {
  const checks = { database: false, keyvalue: false, media: false };
  let installed = false;
  try { await c.env.DB.prepare('SELECT 1 AS x').first(); checks.database = true; } catch { /* reported below */ }
  try { installed = !!(await c.env.KV.get('installed')); checks.keyvalue = true; } catch { /* reported below */ }
  try { await c.env.MEDIA.get('health-check/none'); checks.media = true; } catch { /* reported below */ }
  const ok = checks.database && checks.keyvalue && checks.media;
  const runtime = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers' ? 'cloudflare-workers' : 'node';
  return c.json({ ok, runtime, installed, checks }, ok ? 200 : 503, { 'Cache-Control': 'no-store' });
});

api.get('/posts', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const perPage = Math.min(50, Math.max(1, Number(c.req.query('per_page')) || 10));
  const settings = await getSettings(c.env);
  const { rows, total } = await listPosts(c.env, { page, perPage });
  return c.json({ page, per_page: perPage, total, posts: await toViews(c.env, rows, settings) });
});

api.get('/:kind{(?:posts|pages)}/:slug', async (c) => {
  const type = c.req.param('kind') === 'posts' ? 'post' : 'page';
  const row = await findContent(c.env, { type, slug: c.req.param('slug') });
  if (!row) return c.json({ error: 'not_found' }, 404);
  const [view] = await toViews(c.env, [row], await getSettings(c.env));
  return c.json(view);
});

api.all('*', (c) => c.json({ error: 'not_found' }, 404));

export default api;
