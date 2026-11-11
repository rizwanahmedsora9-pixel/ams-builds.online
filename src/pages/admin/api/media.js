import { getStore } from '../../../lib/store.mjs';
import {
  json,
  rejectCrossSite,
  requireSession,
} from '../../../lib/admin-http.mjs';
import { mediaFileName } from '../../../lib/slug.mjs';
import { repoImages, repoImagePaths } from '../../../lib/media-files.mjs';

export const prerender = false;

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 4 * 1024 * 1024;

export async function GET({ request, locals }) {
  const store = await getStore(locals);
  const session = await requireSession(request, store);
  if (!session.ok) return json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const byPath = new Map();
  for (const img of repoImages()) byPath.set(img.path, img);
  for (const item of await store.listMedia()) byPath.set(item.path, { ...item, source: 'cms' });
  const items = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return json({ ok: true, items });
}

// Upload one image (multipart form field "file").
export async function POST({ request, locals }) {
  const guard = rejectCrossSite(request);
  if (guard) return guard;
  const store = await getStore(locals);
  const session = await requireSession(request, store);
  if (!session.ok) return json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Send the image as multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return json({ ok: false, error: 'No file received' }, { status: 400 });
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return json({ ok: false, error: 'Only JPG, PNG, WebP or GIF images are allowed' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return json({ ok: false, error: 'Image is larger than 4 MB — resize it first' }, { status: 400 });
  }

  const existing = repoImagePaths();
  for (const m of await store.listMedia()) existing.add(m.path.split('/').pop());
  const name = mediaFileName(file.name, existing);
  const path = `/images/uploads/${name}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const result = await store.putMedia(path, file.type, bytes);
  if (!result.ok) {
    const reason = {
      'bad-path': 'Invalid file name',
      'bad-type': 'Only JPG, PNG, WebP or GIF images are allowed',
      'too-large': 'Image is larger than 4 MB — resize it first',
      empty: 'The file is empty',
    }[result.reason] || 'Upload failed';
    return json({ ok: false, error: reason }, { status: 400 });
  }

  return json({ ok: true, path, url: path, size: result.size }, { status: 201 });
}

export async function DELETE({ request, locals, url }) {
  const guard = rejectCrossSite(request);
  if (guard) return guard;
  const store = await getStore(locals);
  const session = await requireSession(request, store);
  if (!session.ok) return json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const path = url.searchParams.get('path') || '';
  if (!/^\/images\/uploads\/[A-Za-z0-9._-]+$/.test(path)) {
    return json({ ok: false, error: 'Bad path' }, { status: 400 });
  }
  const result = await store.deleteMedia(path);
  return json({ ok: true, existed: result.existed });
}
