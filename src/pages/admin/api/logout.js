import { getStore } from '../../../lib/store.mjs';
import {
  json,
  clearSessionCookie,
  rejectCrossSite,
  readCookies,
  SESSION_COOKIE,
} from '../../../lib/admin-http.mjs';

export const prerender = false;

export async function POST({ request, locals }) {
  const guard = rejectCrossSite(request);
  if (guard) return guard;
  const id = readCookies(request)[SESSION_COOKIE];
  if (id) {
    const store = await getStore(locals);
    await store.logout(id);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': clearSessionCookie(request),
      'cache-control': 'no-store',
    },
  });
}
