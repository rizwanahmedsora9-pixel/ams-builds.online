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

/* ------------------------------------------------------- content security policy */

/**
 * Per-response CSP nonce. Not a secret (it is in the HTML by design); it only
 * has to be unguessable per response, which 16 random bytes are.
 */
export function nonceFor(): string {
  // 16 bytes as unpadded base64url: no characters that need escaping in HTML.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type CspMode = 'off' | 'report' | 'enforce';

/**
 * The site's Content-Security-Policy.
 *
 * Themes may ship a script as an asset (`theme.js`), which is `'self'`; inline
 * code only runs when it carries the response nonce, which the renderer adds to
 * the site's own custom JS/CSS and hook snippets. `report` emits the same policy
 * as `Content-Security-Policy-Report-Only` so a site can try it safely.
 */
export function cspFor(opts: { mode: CspMode; nonce: string }): { header: string; value: string } | null {
  if (opts.mode === 'off') return null;
  // A page with no inline code carries no nonce: emitting `'nonce-'` would be a
  // token that can never match, and an empty one reads like a bug in the header.
  const nonce = opts.nonce ? ` 'nonce-${opts.nonce}'` : '';
  const value = [
    "default-src 'self'",
    `script-src 'self'${nonce}`,
    `style-src 'self' 'unsafe-inline'${nonce}`,
    // A nonce switches 'unsafe-inline' off for the whole directive, which would
    // also drop the width/alignment the editor saves on an image or app block.
    // Style *attributes* get their own rule; they cannot run script.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "media-src 'self' https:",
    "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
  return { header: opts.mode === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', value };
}

/* ---------------------------------------------------------------- sanitizer */

const ALLOWED_TAGS = new Set(
  ('a abbr b blockquote br caption cite code col colgroup dd del details div dl dt em figcaption figure ' +
    'h1 h2 h3 h4 h5 h6 hr i iframe img ins kbd li mark ol p pre q s small span strong sub summary sup ' +
    'table tbody td tfoot th thead tr u ul').split(' '),
);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);
const GLOBAL_ATTRS = ['class', 'id', 'title', 'lang', 'dir'];
const TAG_ATTRS: Record<string, string[]> = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  iframe: ['src', 'title', 'width', 'height', 'loading', 'allow', 'referrerpolicy', 'allowfullscreen'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  ol: ['start', 'type'],
  details: ['open'],
};
const URL_ATTRS = new Set(['href', 'src']);

/**
 * Image sizing/alignment written by the editor (width:% + align classes) is
 * stored as inline style. Only those exact, value-checked declarations may
 * survive sanitizing — anything else in a style attribute is dropped whole.
 */
const SAFE_STYLE_TAGS = new Set(['figure', 'img', 'div', 'p', 'h2', 'h3', 'h4', 'blockquote']);
const SAFE_STYLE_VALUE = /^(\d{1,3}(?:\.\d+)?%|\d{1,4}px|auto|left|right|center|justify|block|none)$/i;
const SAFE_STYLE_PROPS = new Set(['width', 'height', 'max-width', 'margin-left', 'margin-right', 'float', 'display', 'text-align']);
export function safeStyle(value: string): string {
  const kept: string[] = [];
  for (const decl of value.split(';')) {
    const [propRaw, ...rest] = decl.split(':');
    const prop = (propRaw || '').trim().toLowerCase();
    const val = rest.join(':').trim().toLowerCase();
    if (!SAFE_STYLE_PROPS.has(prop) || !SAFE_STYLE_VALUE.test(val)) continue;
    if (prop === 'width' && val.endsWith('%') && parseFloat(val) > 100) continue;
    // A height is only ever the pixel height of an embedded app block.
    if (prop === 'height' && !/^\d{2,4}px$/.test(val)) continue;
    kept.push(`${prop}:${val}`);
    if (kept.length >= 6) break;
  }
  return kept.join(';');
}
// Elements whose whole content is dropped, not just the tags.
const DROP_BLOCKS = /<(script|style|object|embed|noscript|template|svg|math|form|textarea|select|button|title|xmp|plaintext|noembed|frameset)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>?/g;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function safeUrl(value: string): string {
  const v = value.replace(/[\u0000-\u0020\u007f]/g, '');
  if (/^(https?:\/\/|mailto:|tel:|\/|#|\?)/i.test(v)) return value.trim();
  // relative path with no scheme and no entity tricks before the query string
  if (/^[\w\-.~%/]+([?#].*)?$/.test(v)) return value.trim();
  return '';
}

/** Only real YouTube embed endpoints are allowed in author-written iframes. */
export function safeYouTubeEmbed(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port &&
      (url.hostname === 'www.youtube.com' || url.hostname === 'www.youtube-nocookie.com') &&
      /^\/embed\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname);
  } catch {
    return false;
  }
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
      let value = (a[2] ?? a[3] ?? a[4] ?? '').replace(/&amp;/g, '&');
      if (name === 'style') {
        // Not in the allow-list above on purpose: handled here, value-checked,
        // and it must run before the allow-list check or it never runs at all.
        if (!SAFE_STYLE_TAGS.has(tag) || seen.has('style')) continue;
        const clean = safeStyle(value).split(';').filter((part) => !['p', 'h2', 'h3', 'h4', 'blockquote'].includes(tag) || part.startsWith('text-align:')).join(';');
        if (!clean) continue;
        seen.add('style');
        attrs += ` style="${esc(clean)}"`;
        continue;
      }
      if (!allowed.includes(name) || seen.has(name)) continue;
      if (URL_ATTRS.has(name)) {
        value = safeUrl(value);
        if (!value || (tag === 'iframe' && !safeYouTubeEmbed(value))) continue;
      }
      seen.add(name);
      attrs += ` ${name}="${esc(value)}"`;
    }
    if (tag === 'iframe' && !seen.has('src')) continue;
    // A new-tab link always carries the rel that stops the target page from
    // reaching back through window.opener; an existing one is replaced, not
    // duplicated. An in-page link keeps whatever rel it was given.
    if (tag === 'a' && /\starget="/.test(attrs)) {
      attrs = attrs.replace(/\srel="[^"]*"/, '') + ' rel="noopener noreferrer"';
    }
    out += `<${tag}${attrs}>`;
  }
  return out + text(src.slice(last));
}

export const stripTags = (html: string): string =>
  // An embedded Python app's source is not prose: keep it out of excerpts.
  html.replace(/<figure\b[^>]*\bclass="[^"]*\bpython-app\b[\s\S]*?<\/figure\s*>/gi, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

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
