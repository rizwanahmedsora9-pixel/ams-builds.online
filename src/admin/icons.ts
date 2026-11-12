/**
 * Admin icon set: one inline SVG sprite per document, referenced with
 * <use href="#i-name">. No icon font, no external request, and the paths are
 * stroke-based on a 24px grid so they inherit the current colour.
 *
 * Adding an icon: add one entry to SYMBOLS and call icon('name') from a screen.
 */
import { html, raw } from '../lib/ui';

type Symbol = [name: string, inner: string];

const SYMBOLS: Symbol[] = [
  ['home', '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/>'],
  ['pin', '<path d="M12 17v5"/><path d="M9 3h6l-1 3 3 3v2H7V9l3-3-1-3Z"/><path d="M8 14h8"/>'],
  ['file', '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'],
  ['image', '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-9 9"/>'],
  ['message', '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"/><path d="M8 8h8M8 12h5"/>'],
  ['palette', '<path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.4 3.4A1.9 1.9 0 0 1 12 21Z"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/>'],
  ['plug', '<path d="M9 3v6M15 3v6"/><path d="M6 9h12v2a6 6 0 0 1-6 6 6 6 0 0 1-6-6Z"/><path d="M12 17v4"/>'],
  ['users', '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M17 14.4a5.5 5.5 0 0 1 3.5 5.1"/>'],
  ['tools', '<path d="M14.5 6.5a4 4 0 0 0 5 5L11 20a2.8 2.8 0 0 1-4-4Z"/><path d="m4 4 3.5 3.5"/>'],
  ['settings', '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.3M17.6 15.2l2.2 1.3M4.2 16.5l2.2-1.3M17.6 8.8l2.2-1.3"/>'],
  ['refresh', '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v4.5h-4.5"/>'],
  ['user', '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'],
  ['logout', '<path d="M15 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9"/><path d="m17 8 4 4-4 4"/><path d="M21 12h-9"/>'],
  ['menu', '<path d="M4 7h16M4 12h16M4 17h16"/>'],
  ['chevron-left', '<path d="m14 6-6 6 6 6"/>'],
  ['chevron-right', '<path d="m10 6 6 6-6 6"/>'],
  ['external', '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'],
  ['sun', '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4"/>'],
  ['moon', '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>'],
  ['monitor', '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/>'],
  ['check', '<path d="m5 13 4.5 4.5L19 7"/>'],
  ['alert', '<path d="M12 4 2.8 20h18.4Z"/><path d="M12 10v4.5M12 17.5v.5"/>'],
  ['info', '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.4"/>'],
  ['search', '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'],
  ['plus', '<path d="M12 5v14M5 12h14"/>'],
  ['grid', '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'],
  ['list', '<path d="M8 6h13M8 12h13M8 18h13M4 6v.01M4 12v.01M4 18v.01"/>'],
  ['edit', '<path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14 6 3 3"/>'],
  ['trash', '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>'],
  ['download', '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 19h16"/>'],
  ['upload', '<path d="M12 16V5"/><path d="M7.5 9.5 12 5l4.5 4.5"/><path d="M4 19h16"/>'],
  ['eye', '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>'],
  ['x', '<path d="m6 6 12 12M18 6 6 18"/>'],
  ['clock', '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>'],
  ['globe', '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 2.6 15.4 0 18-2.6-2.6-2.6-15.4 0-18Z"/>'],
  ['play', '<circle cx="12" cy="12" r="9"/><path d="M10 8.2v7.6l6.3-3.8Z"/>'],
];

const symbolMarkup = (): string =>
  '<svg xmlns="http://www.w3.org/2000/svg" class="sr-only" aria-hidden="true" focusable="false">' +
  SYMBOLS.map(([name, inner]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`).join('') +
  '</svg>';

let cached: ReturnType<typeof raw> | null = null;

/** The sprite. Rendered once per document by shell(). */
export function iconSprite() {
  if (!cached) cached = raw(symbolMarkup());
  return cached;
}

/** One icon. Decorative by default; pass a label to expose it to screen readers. */
export function icon(name: string, opts: { label?: string; cls?: string } = {}) {
  const cls = opts.cls ? `ico ${opts.cls}` : 'ico';
  if (opts.label) {
    return html`<svg class="${cls}" role="img" aria-label="${opts.label}"><use href="#i-${name}"></use></svg>`;
  }
  return html`<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

/** Names are exported for tests that assert every nav entry has a real icon. */
export const ICON_NAMES = SYMBOLS.map(([name]) => name);
