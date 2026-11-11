import { getStore } from '../../../lib/store.mjs';
import {
  json,
  sessionCookie,
  rejectCrossSite,
  readJsonBody,
} from '../../../lib/admin-http.mjs';

export const prerender = false;

const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

const MESSAGES = {
  'bad-credentials': 'Wrong username or password.',
  locked: 'Too many attempts — wait a few minutes and try again.',
  missing: 'Enter your username and password.',
};

export async function POST({ request, locals }) {
  const guard = rejectCrossSite(request);
  if (guard) return guard;

  let body;
  try {
    body = await readJsonBody(request, 4096);
  } catch {
    return json({ ok: false, error: 'Bad request' }, { status: 400 });
  }

  const store = await getStore(locals);
  const result = await store.login(body.username, body.password);
  if (!result.ok) {
    return json(
      {
        ok: false,
        reason: result.reason,
        retryAt: result.retryAt || null,
        error: MESSAGES[result.reason] || 'Sign-in failed.',
      },
      { status: result.reason === 'locked' ? 429 : 401 },
    );
  }

  return new Response(JSON.stringify({ ok: true, user: result.user }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': sessionCookie(request, result.session, SESSION_MAX_AGE),
      'cache-control': 'no-store',
    },
  });
}
