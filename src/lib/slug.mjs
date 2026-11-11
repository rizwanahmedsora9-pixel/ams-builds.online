// URL slug rules — filename is the URL: /blog/<slug>/, /projects/<slug>/, /<slug>/
export const SLUG_MAX = 80;

export function slugify(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(slug);
}

/** Slug that is safe to use as a media filename (keeps the extension). */
export function mediaFileName(originalName, taken) {
  const dot = String(originalName || '').lastIndexOf('.');
  const extRaw = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : '';
  const ext = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extRaw) ? extRaw : 'jpg';
  const base = slugify(dot > 0 ? originalName.slice(0, dot) : originalName) || 'image';
  let candidate = `${base}.${ext}`;
  let n = 1;
  while (taken && taken.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}.${ext}`;
  }
  return candidate;
}
