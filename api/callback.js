import { completeOAuthCallback } from '../worker/oauth.js';

function resolveQuery(req) {
  if (req.query && Object.keys(req.query).length > 0) return req.query;
  try {
    const parsed = new URL(req.url || '/', 'https://ams-builds.online');
    return Object.fromEntries(parsed.searchParams.entries());
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  const outcome = await completeOAuthCallback({
    method: req.method,
    query: resolveQuery(req),
    headers: req.headers || null,
    requestUrl: req.url || '',
    env: process.env,
  });

  for (const [name, value] of Object.entries(outcome.headers || {})) {
    res.setHeader(name, value);
  }

  if (typeof res.status === 'function') res.status(outcome.status);
  else res.statusCode = outcome.status;
  return res.end(outcome.body);
}
