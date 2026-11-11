import { getStore } from '../../../lib/store.mjs';
import {
  json,
  rejectCrossSite,
  readJsonBody,
  requireSession,
} from '../../../lib/admin-http.mjs';
import { fileEntries, fileSettings } from '../../../lib/content-files.mjs';
import { isValidSlug } from '../../../lib/slug.mjs';
import { validateEntry, validateSettings } from '../../../lib/fields.mjs';

export const prerender = false;

const TYPES = ['blog', 'pages', 'projects'];

async function auth(request, locals) {
  const store = await getStore(locals);
  const session = await requireSession(request, store);
  return { store, session };
}

// Full entry for the editor (CMS override wins over the git file).
export async function GET({ request, locals, url }) {
  const { store, session } = await auth(request, locals);
  if (!session.ok) return json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const type = url.searchParams.get('type');
  const slug = url.searchParams.get('slug');

  if (type === 'settings') {
    const stored = await store.getEntry('site');
    const overridden = Boolean(stored && !stored.deleted);
    const data = overridden ? stored.frontmatter : fileSettings();
    return json({
      ok: true,
      entry: {
        type: 'settings',
        slug: 'site',
        data,
        source: overridden ? 'cms' : 'file',
        updated_at: overridden ? stored.updated_at : null,
      },
    });
  }

  if (!TYPES.includes(type) || !isValidSlug(slug)) {
    return json({ ok: false, error: 'Bad entry' }, { status: 400 });
  }

  const stored = await store.getEntry(slug);
  if (stored && !stored.deleted && stored.type === type) {
    return json({
      ok: true,
      entry: { type, slug, data: stored.frontmatter, body: stored.body, source: 'cms', updated_at: stored.updated_at },
    });
  }

  const file = fileEntries().find((e) => e.slug === slug && e.type === type);
  if (!file) return json({ ok: false, error: 'Not found' }, { status: 404 });
  return json({
    ok: true,
    entry: { type, slug, data: file.data, body: file.body, source: 'file', updated_at: null },
  });
}

// Create / update.
export async function POST({ request, locals }) {
  const guard = rejectCrossSite(request);
  if (guard) return guard;
  const { store, session } = await auth(request, locals);
  if (!session.ok) return json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  let body;
  try {
    body = await readJsonBody(request, 4 * 1024 * 1024);
  } catch {
    return json({ ok: false, error: 'Bad request' }, { status: 400 });
  }

  const type = body.type;
  const slug = type === 'settings' ? 'site' : body.slug;
  const data = body.data;
  const content = typeof body.body === 'string' ? body.body : '';

  if (type === 'settings') {
    const errors = validateSettings(data);
    if (errors.length) return json({ ok: false, errors }, { status: 400 });
    const result = await store.putEntry('site', 'settings', data, '');
    return json({ ok: true, slug: 'site', updated_at: result.updated_at });
  }

  if (!TYPES.includes(type) || !isValidSlug(slug)) {
    return json({ ok: false, errors: ['Pick a valid URL slug (lowercase letters, numbers and dashes)'] }, { status: 400 });
  }
  const errors = validateEntry(type, data, content);
  if (errors.length) return json({ ok: false, errors }, { status: 400 });

  const result = await store.putEntry(slug, type, data, content);
  return json({ ok: true, slug, updated_at: result.updated_at });
}

// Delete (tombstone for file-backed entries).
export async function DELETE({ request, locals, url }) {
  const guard = rejectCrossSite(request);
  if (guard) return guard;
  const { store, session } = await auth(request, locals);
  if (!session.ok) return json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const type = url.searchParams.get('type');
  const slug = url.searchParams.get('slug');
  if (!TYPES.includes(type) || !isValidSlug(slug)) {
    return json({ ok: false, error: 'Bad entry' }, { status: 400 });
  }
  await store.deleteEntry(slug, type);
  return json({ ok: true });
}
