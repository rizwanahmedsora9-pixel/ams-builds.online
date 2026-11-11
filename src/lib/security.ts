import type { Env } from '../types';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** Hostname[:port] only - strips scheme, path and whitespace. */
export function cleanDomain(input: string): string {
  const d = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '');
  return /^[a-z0-9.-]+(:\d+)?$/.test(d) ? d : '';
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** State-changing requests must come from our own origin when the browser says where they came from. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser client; CSRF token still applies
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- sanitizer */

const ALLOWED_TAGS = new Set(
  ('a abbr b blockquote br caption cite code col colgroup dd del details div dl dt em figcaption figure ' +
    'h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q s small span strong sub summary sup ' +
    'table tbody td tfoot th thead tr u ul').split(' '),
);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);
const GLOBAL_ATTRS = ['class', 'id', 'title', 'lang', 'dir'];
const TAG_ATTRS: Record<string, string[]> = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  ol: ['start', 'type'],
  details: ['open'],
};
const URL_ATTRS = new Set(['href', 'src']);
// Elements whose whole content is dropped, not just the tags.
const DROP_BLOCKS = /<(script|style|iframe|object|embed|noscript|template|svg|math|form|textarea|select|button|title|xmp|plaintext|noembed|frameset)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>?/g;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function safeUrl(value: string): string {
  const v = value.replace(/[\u0000-\u0020\u007f]/g, '');
  if (/^(https?:\/\/|mailto:|tel:|\/|#|\?)/i.test(v)) return value.trim();
  // relative path with no scheme and no entity tricks before the query string
  if (/^[\w\-.~%/]+([?#].*)?$/.test(v)) return value.trim();
  return '';
}

/**
 * Allow-list HTML sanitizer for content written by non-admin users.
 * Output contains only allow-listed tags/attributes; everything else is
 * removed and any stray "<" is escaped.
 */
export function sanitizeHtml(input: string): string {
  const src = input.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(DROP_BLOCKS, '');
  const text = (s: string) => s.replace(/</g, '&lt;');
  let out = '';
  let last = 0;
  for (const m of src.matchAll(TAG)) {
    out += text(src.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (m[1]) {
      if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
      continue;
    }
    const allowed = [...GLOBAL_ATTRS, ...(TAG_ATTRS[tag] || [])];
    let attrs = '';
    const seen = new Set<string>();
    for (const a of m[3].matchAll(ATTR)) {
      const name = a[1].toLowerCase();
      if (!allowed.includes(name) || seen.has(name)) continue;
      seen.add(name);
      let value = (a[2] ?? a[3] ?? a[4] ?? '').replace(/&amp;/g, '&');
      if (URL_ATTRS.has(name)) {
        value = safeUrl(value);
        if (!value) continue;
      }
      attrs += ` ${name}="${esc(value)}"`;
    }
    if (tag === 'a' && /target=/.test(attrs)) attrs = attrs.replace(/ rel="[^"]*"/, '') + ' rel="noopener noreferrer"';
    out += `<${tag}${attrs}>`;
  }
  return out + text(src.slice(last));
}

export const stripTags = (html: string): string =>
  html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/* --------------------------------------------------------------- rate limit */

export const clientIp = (req: Request): string => req.headers.get('cf-connecting-ip') || 'local';

/** Fixed-window counter in KV. Returns how many hits are recorded for the key. */
export async function rateCount(env: Env, key: string): Promise<number> {
  return Number((await env.KV.get('rl:' + key)) || 0);
}
export async function rateHit(env: Env, key: string, windowSeconds: number): Promise<void> {
  const n = (await rateCount(env, key)) + 1;
  await env.KV.put('rl:' + key, String(n), { expirationTtl: Math.max(60, windowSeconds) });
}
export async function rateReset(env: Env, key: string): Promise<void> {
  await env.KV.delete('rl:' + key);
}
