const DEFAULT_SITE_URL = 'https://ams-builds.online';
export const STATE_COOKIE = 'ams_decap_oauth_state';

function getHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return headers.get(name) || '';
  }
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return Array.isArray(v) ? v[0] || '' : String(v || '');
    }
  }
  return '';
}

export function resolveSiteOrigin({ env = {}, requestUrl = '', headers = null } = {}) {
  const configured = (env.CMS_PUBLIC_URL || '').trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to request origin
    }
  }

  const fwdHost = getHeader(headers, 'x-forwarded-host').split(',')[0].trim();
  const host = fwdHost || getHeader(headers, 'host').split(',')[0].trim();
  if (host && /^[a-zA-Z0-9.:-]+$/.test(host)) {
    const fwdProto = getHeader(headers, 'x-forwarded-proto').split(',')[0].trim().toLowerCase();
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    const proto = fwdProto === 'http' || fwdProto === 'https' ? fwdProto : isLocal ? 'http' : 'https';
    return `${proto}://${host}`;
  }

  if (requestUrl) {
    try {
      const parsed = new URL(requestUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // ignore relative URLs
    }
  }

  return DEFAULT_SITE_URL;
}

function randomHex(bytes = 32) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export function readCookie(cookieHeader, name) {
  for (const part of (cookieHeader || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return '';
}

export function stateMatches(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  if (!expected || !actual || expected.length !== actual.length) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(expected);
  const b = encoder.encode(actual);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function firstParam(query, key) {
  if (!query) return '';
  if (query instanceof URLSearchParams) {
    return query.get(key) || '';
  }
  const value = query[key];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function cookieSecurityAttributes(siteOrigin) {
  const secure = siteOrigin.startsWith('https://') ? ' Secure;' : '';
  return `Path=/; HttpOnly;${secure} SameSite=Lax`;
}

function renderNotConfiguredHtml(siteOrigin) {
  const callbackUrl = `${siteOrigin}/callback`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CMS GitHub OAuth Setup Required</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; line-height: 1.6; }
    main { max-width: 640px; margin: 24px auto; background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 24px; }
    h1 { font-size: 1.25rem; margin: 0 0 12px; color: #fbbf24; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 6px; color: #fde68a; word-break: break-all; }
    ol { padding-left: 20px; }
    li { margin-bottom: 8px; }
  </style>
</head>
<body>
  <main>
    <h1>CMS GitHub OAuth is not configured</h1>
    <p>Set the GitHub OAuth credentials in your hosting project to enable sign-in at <code>/admin/</code>:</p>
    <ol>
      <li>In GitHub → <strong>Settings → Developer settings → OAuth Apps → New OAuth App</strong>, set <strong>Authorization callback URL</strong> to:<br /><code>${escapeHtml(callbackUrl)}</code></li>
      <li>Add <code>GITHUB_OAUTH_CLIENT_ID</code> and <code>GITHUB_OAUTH_CLIENT_SECRET</code> to your Cloudflare Worker (<strong>Settings → Variables and Secrets</strong>) or Vercel project (<strong>Settings → Environment Variables</strong>).</li>
      <li>Close this window and click <strong>Login with GitHub</strong> again.</li>
    </ol>
  </main>
</body>
</html>`;
}

export function renderCallbackHtml(siteOrigin, type, payload) {
  const normalizedPayload =
    type === 'error'
      ? {
          message: payload.message || payload.error || 'Authentication failed.',
          error: payload.error || payload.message || 'Authentication failed.',
        }
      : payload;
  const message = `authorization:github:${type}:${JSON.stringify(normalizedPayload)}`;
  const fallbackText =
    type === 'success'
      ? 'Sign-in complete. You may close this window.'
      : normalizedPayload.message;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CMS sign-in</title>
</head>
<body>
  <p id="status">${escapeHtml(type === 'success' ? 'Returning to the CMS…' : normalizedPayload.message)}</p>
  <script>
    (function () {
      var handshake = "authorizing:github";
      var resultMessage = ${escapeForInlineScript(message)};
      var expectedOrigin = ${escapeForInlineScript(siteOrigin)};
      var fallbackText = ${escapeForInlineScript(fallbackText)};
      if (!window.opener) {
        document.getElementById("status").textContent = fallbackText;
        return;
      }
      var completed = false;
      function sendResult(targetOrigin) {
        if (completed) return;
        completed = true;
        window.removeEventListener("message", onHandshakeReply, false);
        window.opener.postMessage(resultMessage, targetOrigin);
        setTimeout(function () { window.close(); }, 150);
      }
      function onHandshakeReply(event) {
        if (event.origin !== expectedOrigin) return;
        if (event.data !== handshake) return;
        sendResult(event.origin);
      }
      window.addEventListener("message", onHandshakeReply, false);
      window.opener.postMessage(handshake, expectedOrigin);
    })();
  </script>
</body>
</html>`;
}

export function createOAuthStart({ method = 'GET', query = {}, headers = null, requestUrl = '', env = {} } = {}) {
  if (method !== 'GET') {
    return {
      status: 405,
      headers: {
        Allow: 'GET',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: 'Method not allowed',
    };
  }

  const siteOrigin = resolveSiteOrigin({ env, requestUrl, headers });
  const clientId = env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: renderNotConfiguredHtml(siteOrigin),
    };
  }

  const provider = firstParam(query, 'provider');
  if (provider && provider !== 'github') {
    return {
      status: 400,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: 'Unsupported OAuth provider',
    };
  }

  const requestedScope = firstParam(query, 'scope');
  const validRequestedScope =
    requestedScope === 'repo' || requestedScope === 'public_repo' ? requestedScope : '';
  const scope = env.GITHUB_OAUTH_SCOPE || validRequestedScope || 'public_repo';

  const state = randomHex(32);
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', `${siteOrigin}/callback`);
  authorizeUrl.searchParams.set('scope', scope);
  authorizeUrl.searchParams.set('state', state);

  return {
    status: 302,
    redirectLocation: authorizeUrl.toString(),
    headers: {
      'Cache-Control': 'no-store',
      'Set-Cookie': `${STATE_COOKIE}=${state}; ${cookieSecurityAttributes(siteOrigin)}; Max-Age=600`,
    },
    body: '',
  };
}

export async function completeOAuthCallback({
  method = 'GET',
  query = {},
  headers = null,
  requestUrl = '',
  env = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  if (method !== 'GET') {
    return {
      status: 405,
      headers: {
        Allow: 'GET',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: 'Method not allowed',
    };
  }

  const siteOrigin = resolveSiteOrigin({ env, requestUrl, headers });
  const clearCookie = `${STATE_COOKIE}=; ${cookieSecurityAttributes(siteOrigin)}; Max-Age=0`;
  const responseHeaders = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'",
    'Set-Cookie': clearCookie,
  };

  const error = firstParam(query, 'error');
  if (error) {
    return {
      status: 400,
      headers: responseHeaders,
      body: renderCallbackHtml(siteOrigin, 'error', {
        message: 'GitHub authorization was cancelled or denied.',
      }),
    };
  }

  const code = firstParam(query, 'code');
  const state = firstParam(query, 'state');
  const cookieHeader = getHeader(headers, 'cookie');
  const cookieState = readCookie(cookieHeader, STATE_COOKIE);
  if (!stateMatches(cookieState, state)) {
    return {
      status: 400,
      headers: responseHeaders,
      body: renderCallbackHtml(siteOrigin, 'error', {
        message: 'OAuth state check failed. Close the window and try signing in again.',
      }),
    };
  }

  if (!code || typeof code !== 'string' || code.length > 2048) {
    return {
      status: 400,
      headers: responseHeaders,
      body: renderCallbackHtml(siteOrigin, 'error', {
        message: 'GitHub did not return an authorization code.',
      }),
    };
  }

  const clientId = env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      status: 503,
      headers: responseHeaders,
      body: renderCallbackHtml(siteOrigin, 'error', {
        message: 'CMS GitHub OAuth is not configured on the hosting project.',
      }),
    };
  }

  try {
    const response = await fetchImpl('https://github.com/login/oauth/access_token', {
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
        redirect_uri: `${siteOrigin}/callback`,
      }),
    });
    const result = await response.json();
    if (!response.ok || result.error || !result.access_token) {
      return {
        status: 502,
        headers: responseHeaders,
        body: renderCallbackHtml(siteOrigin, 'error', {
          message: 'GitHub could not complete sign-in. Check the OAuth App callback URL and try again.',
        }),
      };
    }

    return {
      status: 200,
      headers: responseHeaders,
      body: renderCallbackHtml(siteOrigin, 'success', {
        token: result.access_token,
        provider: 'github',
      }),
    };
  } catch {
    return {
      status: 502,
      headers: responseHeaders,
      body: renderCallbackHtml(siteOrigin, 'error', {
        message: 'Could not reach GitHub to complete sign-in. Please try again.',
      }),
    };
  }
}
