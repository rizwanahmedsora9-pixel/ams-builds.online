import { getStore } from '../../../lib/store.mjs';
import { json, requireSession } from '../../../lib/admin-http.mjs';
import { fileEntries } from '../../../lib/content-files.mjs';
import { repoImages } from '../../../lib/media-files.mjs';
import { mergeEntries } from '../../../lib/merge.mjs';

export const prerender = false;

export async function GET({ request, locals }) {
  const store = await getStore(locals);
  const session = await requireSession(request, store);
  if (!session.ok) return json({ ok: false, authenticated: false }, { status: 401 });

  const overrides = await store.listEntries();
  const entries = mergeEntries(fileEntries(), overrides);
  const media = await store.listMedia();
  const counts = { blog: 0, pages: 0, projects: 0, settings: 0 };
  for (const entry of entries) {
    if (counts[entry.type] !== undefined) counts[entry.type] += 1;
  }

  return json({
    ok: true,
    authenticated: true,
    user: session.user,
    store: store.kind,
    counts,
    mediaCount: repoImages().length + media.length,
    hasOverrides: overrides.length > 0,
    live: true,
  }, { headers: { 'cache-control': 'no-store' } });
}
