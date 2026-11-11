// Worker-safe Markdown rendering. Shiki's oniguruma WebAssembly engine cannot
// execute during a Cloudflare request, so runtime pages use marked (pure JS)
// and sanitize the resulting HTML before serving it to visitors.
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const allowedTags = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'del', 's', 'blockquote', 'code', 'pre',
  'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'div', 'span', 'section', 'details', 'summary', 'sup', 'sub', 'kbd',
];

export async function renderMarkdown(body) {
  const html = marked.parse(String(body ?? ''), { gfm: true, breaks: false, async: false });
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      code: ['class'],
      th: ['align'],
      td: ['align'],
      div: ['class'],
      span: ['class'],
      section: ['class'],
    },
    allowedClasses: {
      code: [/^language-[\w-]+$/],
      div: [/^[\w\s-]+$/],
      span: [/^[\w\s-]+$/],
      section: [/^[\w\s-]+$/],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}),
        },
      }),
    },
  });
}
