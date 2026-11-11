import { getStore } from '../../../lib/store.mjs';

export const prerender = false;

const FILE_RE = /^[A-Za-z0-9._-]+$/;

// Serves images that only exist in CMS storage. Images committed to the repo
// are static assets and never reach this route.
export async function GET({ params, locals }) {
  const segments = Array.isArray(params.path) ? params.path : [params.path];
  if (segments.length !== 1 || !FILE_RE.test(segments[0] || '')) {
    return new Response('Not found', { status: 404 });
  }
  const path = `/images/uploads/${segments[0]}`;

  let media;
  try {
    const store = await getStore(locals);
    media = await store.getMedia(path);
  } catch {
    media = null;
  }
  if (!media) return new Response('Not found', { status: 404 });

  return new Response(media.content, {
    status: 200,
    headers: {
      'content-type': media.mime,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-length': String(media.size),
    },
  });
}
