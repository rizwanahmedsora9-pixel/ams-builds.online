// Cloudflare Worker entry: re-exports the built Astro app and the CmsSite
// Durable Object class (the migration in wrangler.jsonc needs the class to be
// exported from the Worker's main module).
import astroWorker from '../dist/_worker.js/index.js';

export { CmsSite } from './cms-do.js';

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    // The admin app lives at /admin/ (trailing slash). Bare /admin has no
    // Astro route, so redirect before the router sees it.
    if (url.pathname === '/admin') {
      url.pathname = '/admin/';
      return Response.redirect(url, 302);
    }
    return astroWorker.fetch(request, env, ctx);
  },
};
