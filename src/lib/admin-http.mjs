// Small HTTP helpers for the admin API: JSON responses, session cookies and
// the CSRF guards (SameSite + custom header + Origin check).
export const SESSION_COOKIE = 'ams_admin_session';
export const ADMIN_HEADER = 'x-requested-with';
export const ADMIN_HEADER_VALUE = 'ams-admin';

export function json(data, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function readCookies(request) {
  const header = request.headers.get('cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionCookie(request, id, maxAgeSeconds) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** Mutations must carry the admin header and a same-origin Origin (when sent). */
export function rejectCrossSite(request) {
  if (request.headers.get(ADMIN_HEADER) !== ADMIN_HEADER_VALUE) {
    return json({ ok: false, error: 'Missing admin header' }, { status: 403 });
  }
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) {
        return json({ ok: false, error: 'Cross-origin request blocked' }, { status: 403 });
      }
    } catch {
      return json({ ok: false, error: 'Bad origin' }, { status: 403 });
    }
  }
  return null;
}

/** Validate the session cookie. Returns { ok, user } or { ok:false }. */
export async function requireSession(request, store) {
  const id = readCookies(request)[SESSION_COOKIE];
  if (!id) return { ok: false, reason: 'anonymous' };
  const result = await store.validateSession(id);
  if (!result.ok) return { ok: false, reason: result.reason || 'invalid' };
  return { ok: true, user: result.user, sessionId: id, expiresAt: result.expiresAt };
}

export async function readJsonBody(request, maxBytes = 2 * 1024 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('Body too large');
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON');
  return parsed;
}
