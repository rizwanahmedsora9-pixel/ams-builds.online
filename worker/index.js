import { createOAuthStart, completeOAuthCallback } from './oauth.js';

function toWorkerResponse(outcome) {
  const headers = new Headers(outcome.headers || {});
  if (outcome.redirectLocation) {
    headers.set('Location', outcome.redirectLocation);
    return new Response(null, { status: outcome.status, headers });
  }
  return new Response(outcome.body, { status: outcome.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/admin') {
      return Response.redirect(`${url.origin}/admin/${url.search}`, 301);
    }

    if (url.pathname === '/auth' || url.pathname === '/api/auth') {
      const outcome = createOAuthStart({
        method: request.method,
        query: url.searchParams,
        headers: request.headers,
        requestUrl: request.url,
        env,
      });
      return toWorkerResponse(outcome);
    }

    if (url.pathname === '/callback' || url.pathname === '/api/callback') {
      const outcome = await completeOAuthCallback({
        method: request.method,
        query: url.searchParams,
        headers: request.headers,
        requestUrl: request.url,
        env,
      });
      return toWorkerResponse(outcome);
    }

    if (env?.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
