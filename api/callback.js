import { timingSafeEqual } from 'node:crypto';

const SITE_URL = process.env.CMS_PUBLIC_URL || 'https://ams-builds.online';
const STATE_COOKIE = 'ams_decap_oauth_state';

function escapeForInlineScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function callbackPage(res, type, payload, status = 200) {
  const message = `authorization:github:${type}:${JSON.stringify(payload)}`;
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'`);
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>CMS sign-in</title></head><body><p>Returning to the CMS…</p><script>if(window.opener){window.opener.postMessage(${escapeForInlineScript(message)},${escapeForInlineScript(SITE_URL)});window.close();}else{document.body.textContent='Sign-in complete. You may close this window.';}</script></body></html>`);
}

function readCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}

function stateMatches(expected, actual) {
  if (!expected || !actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).end('Method not allowed');
    return;
  }

  const clearCookie = `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  res.setHeader('Set-Cookie', clearCookie);

  const query = req.query || {};
  const error = Array.isArray(query.error) ? query.error[0] : query.error;
  if (error) {
    callbackPage(res, 'error', { error: 'GitHub authorization was cancelled or denied.' }, 400);
    return;
  }

  const code = Array.isArray(query.code) ? query.code[0] : query.code;
  const state = Array.isArray(query.state) ? query.state[0] : query.state;
  const cookieState = readCookie(req.headers.cookie, STATE_COOKIE);
  if (!stateMatches(cookieState, state)) {
    callbackPage(res, 'error', { error: 'OAuth state check failed. Close the window and try signing in again.' }, 400);
    return;
  }
  if (!code || typeof code !== 'string' || code.length > 2048) {
    callbackPage(res, 'error', { error: 'GitHub did not return an authorization code.' }, 400);
    return;
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    callbackPage(res, 'error', { error: 'CMS GitHub OAuth is not configured on the hosting project.' }, 503);
    return;
  }

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'AMS-Builds-Decap-CMS',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${SITE_URL}/callback`,
      }),
    });
    const result = await response.json();
    if (!response.ok || result.error || !result.access_token) {
      callbackPage(res, 'error', { error: 'GitHub could not complete sign-in. Check the OAuth App callback URL and try again.' }, 502);
      return;
    }

    callbackPage(res, 'success', { token: result.access_token, provider: 'github' });
  } catch {
    callbackPage(res, 'error', { error: 'Could not reach GitHub to complete sign-in. Please try again.' }, 502);
  }
}
