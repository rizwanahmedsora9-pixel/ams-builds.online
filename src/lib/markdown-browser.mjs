// Safe client-side Markdown renderer using `marked` for live CMS previews and
// dynamically rendered CMS entries in the browser.
import { Marked } from 'marked';

const marked = new Marked({
  gfm: true,
  breaks: false,
});

const DANGEROUS_TAG_RE = /<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)\b[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>|<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link|base)\b[^>]*\/?>/gi;
const EVENT_ATTR_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const BAD_HREF_RE = /\b(href|src|action|formaction)\s*=\s*(?:"\s*(?:javascript:|vbscript:|data:text\/html)[^"]*"|'\s*(?:javascript:|vbscript:|data:text\/html)[^']*'|[^\s>]*javascript:[^\s>]*)/gi;

export function sanitizeHtml(html) {
  return String(html ?? '')
    .replace(DANGEROUS_TAG_RE, '')
    .replace(EVENT_ATTR_RE, '')
    .replace(BAD_HREF_RE, '$1="#"');
}

export function renderMarkdownClient(markdown) {
  const html = marked.parse(String(markdown ?? ''));
  return sanitizeHtml(html);
}
