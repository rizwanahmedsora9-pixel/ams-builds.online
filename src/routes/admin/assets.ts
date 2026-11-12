import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { assetVersion, getBundle } from '../../admin/bundles';

/**
 * Panel stylesheets. Public within the admin prefix: they contain no data, and
 * letting the browser cache them for a year is the whole point. The ?v= stamp
 * matches the bytes, so a deploy can never serve a stale sheet.
 */
const assets = new Hono<AppEnv>();

assets.get('/assets/:file{[a-z]+\\.css}', (c) => {
  const name = c.req.param('file').replace(/\.css$/, '');
  const bundle = getBundle(name);
  if (!bundle) return c.notFound();
  const headers = {
    'Content-Type': 'text/css; charset=utf-8',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: bundle.etag,
    'X-Content-Type-Options': 'nosniff',
  };
  if (c.req.header('if-none-match') === bundle.etag) return new Response(null, { status: 304, headers });
  return new Response(bundle.css, { headers });
});

// A missing asset inside the panel should not fall through to the site.
assets.get('/assets/*', (c) => c.notFound());

export { assetVersion };
export default assets;
