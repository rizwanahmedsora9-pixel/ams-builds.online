import { getStore } from '../../../lib/store.mjs';
import { json, requireSession } from '../../../lib/admin-http.mjs';
import { fileEntries } from '../../../lib/content-files.mjs';

export const prerender = false;

const TYPES = ['blog', 'pages', 'projects'];

// Union of the git files and CMS overrides: what the admin list shows.
export async function GET({ request, locals, url }) {
  const store = await getStore(locals);
  const session = await requireSession(request, store);
  if (!session.ok) return json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const type = url.searchParams.get('type');
  if (!TYPES.includes(type)) {
    return json({ ok: false, error: 'Unknown content type' }, { status: 400 });
  }

  const rows = new Map();
  for (const entry of fileEntries()) {
    if (entry.type !== type) continue;
    rows.set(entry.slug, {
      slug: entry.slug,
      type,
      data: entry.data,
      source: 'file',
      hasBody: Boolean(entry.body),
      updated_at: null,
    });
  }

  for (const row of await store.listEntries()) {
    if (row.type !== type) continue;
    if (row.deleted) {
      rows.delete(row.slug);
      continue;
    }
    rows.set(row.slug, {
      slug: row.slug,
      type,
      data: row.frontmatter || {},
      source: 'cms',
      hasBody: true,
      updated_at: row.updated_at,
    });
  }

  const items = [...rows.values()].sort((a, b) => {
    const da = a.data?.date || a.data?.pubDate || '';
    const db = b.data?.date || b.data?.pubDate || '';
    if (da !== db) return db < da ? -1 : 1;
    return (a.data?.title || '').localeCompare(b.data?.title || '');
  });

  return json({ ok: true, items });
}
