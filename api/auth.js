import { randomBytes } from 'node:crypto';

const SITE_URL = process.env.CMS_PUBLIC_URL || 'https://ams-builds.online';
const STATE_COOKIE = 'ams_decap_oauth_state';

function sendError(res, status, message) {
  res.status(status).setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'Method not allowed');
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId || !process.env.GITHUB_OAUTH_CLIENT_SECRET) {
    return sendError(res, 503, 'CMS GitHub OAuth is not configured. Set the required Vercel environment variables.');
  }

  const provider = Array.isArray(req.query?.provider) ? req.query.provider[0] : req.query?.provider;
  if (provider && provider !== 'github') {
    return sendError(res, 400, 'Unsupported OAuth provider');
  }

  const state = randomBytes(32).toString('hex');
  const scope = process.env.GITHUB_OAUTH_SCOPE || 'public_repo';
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', `${SITE_URL}/callback`);
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('state', state);

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  res.redirect(302, authorizeUrl.toString());
}
