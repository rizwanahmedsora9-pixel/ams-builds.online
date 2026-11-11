import { getStore } from '../../../lib/store.mjs';
import {
  json,
  rejectCrossSite,
  readJsonBody,
  requireSession,
} from '../../../lib/admin-http.mjs';

export const prerender = false;

const MESSAGES = {
  'bad-current': 'The current password is wrong.',
  'too-short': 'The new password must be at least 6 characters.',
  'no-password': 'No password is set yet — sign in first.',
  unauthenticated: 'Your session expired — sign in again.',
};

export async function POST({ request, locals }) {
  const guard = rejectCrossSite(request);
  if (guard) return guard;

  let body;
  try {
    body = await readJsonBody(request, 8192);
  } catch {
    return json({ ok: false, error: 'Bad request' }, { status: 400 });
  }

  const store = await getStore(locals);
  const session = await requireSession(request, store);
  if (!session.ok) {
    return json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  }

  const result = await store.changePassword(session.sessionId, body.current, body.next);
  if (!result.ok) {
    return json(
      { ok: false, reason: result.reason, error: MESSAGES[result.reason] || 'Could not change the password.' },
      { status: result.reason === 'unauthenticated' ? 401 : 400 },
    );
  }
  return json({ ok: true });
}
