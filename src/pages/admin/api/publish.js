import { getStore } from '../../../lib/store.mjs';
import { json, rejectCrossSite, requireSession } from '../../../lib/admin-http.mjs';
import { triggerPublish } from '../../../lib/publish.mjs';

export const prerender = false;

export async function POST({ request, locals }) {
  const guard = rejectCrossSite(request);
  if (guard) return guard;

  const store = await getStore(locals);
  const session = await requireSession(request, store);
  if (!session.ok) return json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const result = await triggerPublish(locals.runtime?.env);
  await store.recordPublish({
    ok: result.ok,
    reason: result.reason,
    message: result.message,
    buildUuid: result.buildUuid || null,
    triggeredBy: session.user,
  });
  return json(result, { status: result.ok ? 200 : 400 });
}
