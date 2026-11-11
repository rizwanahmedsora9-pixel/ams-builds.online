import { getStore } from '../../../lib/store.mjs';
import { json, requireSession } from '../../../lib/admin-http.mjs';
import { deployHookUrl } from '../../../lib/publish.mjs';

export const prerender = false;

export async function GET({ request, locals }) {
  const store = await getStore(locals);
  const session = await requireSession(request, store);
  if (!session.ok) return json({ ok: false, authenticated: false }, { status: 401 });

  const entries = await store.listEntries();
  const media = await store.listMedia();
  const counts = { blog: 0, pages: 0, projects: 0, settings: 0 };
  for (const row of entries) {
    if (row.deleted) continue;
    if (counts[row.type] !== undefined) counts[row.type] += 1;
  }

  const lastPublish = await store.getLastPublish();
  const maxUpdated = entries
    .filter((row) => !row.deleted && row.updated_at)
    .reduce((max, row) => (row.updated_at > max ? row.updated_at : max), '');

  return json({
    ok: true,
    authenticated: true,
    user: session.user,
    store: store.kind,
    counts,
    mediaCount: media.length,
    lastPublish,
    hookConfigured: Boolean(deployHookUrl(locals.runtime?.env)),
    hasOverrides: entries.some((row) => !row.deleted),
    pendingChanges: Boolean(maxUpdated && (!lastPublish?.at || maxUpdated > lastPublish.at)),
  });
}
