/**
 * Design tokens.
 *
 * A site's brand (colours, type, radius, width, scheme) is stored as a handful of
 * `settings` keys and emitted as a `:root { … }` block *after* the theme's own
 * stylesheet, so every theme that reads a variable follows the panel — and a
 * theme that hard-codes a value simply keeps it. Nothing here is required: an
 * unset token emits no CSS at all, so an untouched site is byte-identical to
 * what it was before this screen existed.
 *
 * The same table drives the Customizer's controls, so a new token is one entry
 * in `TOKENS`, not a new form field, a new route and a new CSS rule.
 */

export type TokenGroup = 'brand' | 'text' | 'surface' | 'shape' | 'type' | 'layout';

export type TokenField =
  | { kind: 'color'; key: string; label: string; help?: string; default: string }
  | { kind: 'text'; key: string; label: string; help?: string; default: string; placeholder?: string; max?: number }
  | { kind: 'select'; key: string; label: string; help?: string; default: string; options: { value: string; label: string }[] }
  | { kind: 'number'; key: string; label: string; help?: string; default: string; min: number; max: number; step?: number; unit: string };

export type TokenGroupDef = { key: TokenGroup; label: string; blurb: string; fields: TokenField[] };

/**
 * Curated type stacks. System-first: no webfont download, nothing from other
 * servers, and every stack degrades to the platform's own fonts.
 */
export const FONT_STACKS: Record<string, string> = {
  system: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
  serif: 'Georgia,"Iowan Old Style","Times New Roman",Times,serif',
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace',
  rounded: 'ui-rounded,"SF Pro Rounded","Nunito","Varela Round",system-ui,sans-serif',
  humanist: '"Frutiger","Seravek","Gill Sans Nova","Ubuntu",Calibri,system-ui,sans-serif',
};

export const TOKENS: TokenGroupDef[] = [
  {
    key: 'brand', label: 'Brand', blurb: 'Links, buttons and every accent in the theme.',
    fields: [
      { kind: 'color', key: 'token_brand', label: 'Brand colour', default: '#2457d6' },
      { kind: 'color', key: 'token_brand_alt', label: 'Second brand colour', help: 'Used by themes with a gradient or a second accent.', default: '#7c3aed' },
      { kind: 'color', key: 'token_on_brand', label: 'Text on brand', help: 'Button labels on a brand-coloured background.', default: '#ffffff' },
    ],
  },
  {
    key: 'text', label: 'Text', blurb: 'Body copy and the softer grey around it.',
    fields: [
      { kind: 'color', key: 'token_text', label: 'Text colour', default: '#1c2330' },
      { kind: 'color', key: 'token_text_muted', label: 'Muted text', default: '#647084' },
    ],
  },
  {
    key: 'surface', label: 'Surfaces', blurb: 'Page background, cards and hairlines.',
    fields: [
      { kind: 'color', key: 'token_bg', label: 'Page background', default: '#ffffff' },
      { kind: 'color', key: 'token_surface', label: 'Cards and panels', default: '#f5f7fa' },
      { kind: 'color', key: 'token_line', label: 'Borders and dividers', default: '#e4e8ee' },
    ],
  },
  {
    key: 'shape', label: 'Shape', blurb: 'Corner rounding and spacing rhythm.',
    fields: [
      { kind: 'number', key: 'token_radius', label: 'Corner radius', default: '10', min: 0, max: 28, unit: 'px' },
    ],
  },
  {
    key: 'type', label: 'Typography', blurb: 'The two stacks every theme inherits.',
    fields: [
      {
        kind: 'select', key: 'token_font_body', label: 'Body font', default: 'system',
        options: [
          { value: 'system', label: 'System (fastest)' }, { value: 'humanist', label: 'Humanist sans' },
          { value: 'rounded', label: 'Rounded sans' }, { value: 'serif', label: 'Serif' },
          { value: 'mono', label: 'Monospace' }, { value: 'custom', label: 'Custom stack…' },
        ],
      },
      { kind: 'text', key: 'token_font_custom', label: 'Custom body stack', help: 'Only used when "Custom stack" is chosen. Fonts must already be installed for the visitor or served by your theme.', default: '', placeholder: '"Inter", system-ui, sans-serif', max: 300 },
      {
        kind: 'select', key: 'token_font_head', label: 'Headings', default: 'inherit',
        options: [
          { value: 'inherit', label: 'Same as body' }, { value: 'system', label: 'System' },
          { value: 'humanist', label: 'Humanist sans' }, { value: 'rounded', label: 'Rounded sans' },
          { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Monospace' },
        ],
      },
      { kind: 'number', key: 'token_type_scale', label: 'Text size', help: 'The base size body copy is set in.', default: '17', min: 14, max: 22, unit: 'px' },
    ],
  },
  {
    key: 'layout', label: 'Layout & scheme', blurb: 'How wide the content runs, and what visitors get by default.',
    fields: [
      { kind: 'number', key: 'token_width', label: 'Content width', default: '46', min: 32, max: 90, unit: 'rem' },
      {
        kind: 'select', key: 'token_scheme', label: 'Colour scheme', default: 'auto',
        options: [{ value: 'auto', label: 'Follow the visitor' }, { value: 'light', label: 'Always light' }, { value: 'dark', label: 'Always dark' }],
      },
    ],
  },
];

export const ALL_TOKEN_FIELDS: TokenField[] = TOKENS.flatMap((g) => g.fields);
const BY_KEY = new Map(ALL_TOKEN_FIELDS.map((f) => [f.key, f]));

/** Values that would turn into CSS injection if pasted into a `:root` block. */
const COLOR = /^#[0-9a-f]{3,8}$/i;

export type TokenValues = Record<string, string>;

/** Saved values only; nothing is invented, so an untouched site emits no CSS. */
export function readTokens(settings: Record<string, string>): TokenValues {
  const out: TokenValues = {};
  for (const field of ALL_TOKEN_FIELDS) {
    const value = settings[field.key];
    if (value !== undefined && value !== '') out[field.key] = value;
  }
  return out;
}

/** Is this value acceptable for this field? Used on save, so bad CSS cannot be stored. */
export function cleanToken(field: TokenField, raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  switch (field.kind) {
    case 'color': {
      const v = value.toLowerCase();
      return COLOR.test(v) ? v : '';
    }
    case 'number': {
      const n = Number(value.replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(n)) return '';
      return String(Math.min(field.max, Math.max(field.min, n)));
    }
    case 'select': {
      const allowed = field.options.map((o) => o.value);
      if (field.key === 'token_font_head') return allowed.includes(value) ? value : '';
      return allowed.includes(value) ? value : field.default;
    }
    default:
      // A custom font stack is CSS, but it may only name fonts and fallbacks.
      return value.replace(/[<>{};\\]/g, '').slice(0, field.max ?? 300);
  }
}

/** Validates a whole submitted set (one form), ignoring keys that are not tokens. */
export function cleanTokens(input: Record<string, unknown>): { values: TokenValues; problems: string[] } {
  const values: TokenValues = {};
  const problems: string[] = [];
  for (const field of ALL_TOKEN_FIELDS) {
    if (!(field.key in input)) continue;
    const raw = String(input[field.key] ?? '').trim();
    const cleaned = cleanToken(field, input[field.key]);
    if (raw && !cleaned && field.kind !== 'select') {
      problems.push(`${field.label}: “${raw.slice(0, 40)}” is not a valid value.`);
      continue;
    }
    if (cleaned) values[field.key] = cleaned;
  }
  return { values, problems };
}

/** `#abc` / `#aabbcc` → `#aabbcc`, so a theme's own notation can be compared. */
export function normaliseHex(value: string): string {
  const v = value.trim().toLowerCase();
  if (!COLOR.test(v)) return v;
  const hex = v.slice(1);
  if (hex.length === 3) return '#' + hex.split('').map((ch) => ch + ch).join('');
  return '#' + hex;
}

/**
 * The CSS custom properties a theme actually reads, in the *current* theme's
 * own stylesheet. The Customizer only offers tokens the theme uses: changing a
 * variable a theme never reads would look broken.
 */
export function themeTokenNames(css: string): Set<string> {
  const names = new Set<string>();
  // Both ways a theme can honour a variable: it reads it somewhere, or it
  // declares it in its own palette. Overriding either changes what a visitor
  // sees — a theme that hard-codes a colour does neither.
  for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) names.add(m[1].toLowerCase());
  for (const m of css.matchAll(/(^|[{;\s])(--[a-z0-9-]+)\s*:/gi)) names.add(m[2].toLowerCase());
  return names;
}

/**
 * Tokens that only shape another token: the custom font stack is fed into
 * `--font-body`, so it is a control, never a variable of its own.
 */
const INPUT_ONLY = new Set(['token_font_custom']);

/** Which tokens map to which `--variable`, camelCase keys becoming kebab-case. */
export function cssVarFor(fieldKey: string): string {
  return INPUT_ONLY.has(fieldKey) ? '' : '--' + fieldKey.replace(/^token_/, '').replace(/_/g, '-');
}

export type TokenHelp = { field: TokenField; variable: string };

/**
 * A token is "supported" when the theme reads it, or reads a variable that maps
 * to it through an alias chain (themes use different names for the same idea:
 * `--fg`, `--text`, `--ink`).
 */


/** Every variable name a token could reach in this theme. */
export function variablesFor(fieldKey: string): string[] {
  const own = cssVarFor(fieldKey);
  if (!own) return [];
  return [own, ...(ALIASES[own] ?? [])];
}

/**
 * Tokens this theme can honour. A CSS variable counts when the theme's
 * stylesheet reads it; the colour scheme is the exception — it reaches the page
 * through `color-scheme` (see render.ts), so every theme honours it.
 */
export function supportedTokens(css: string): TokenField[] {
  const used = themeTokenNames(css);
  return ALL_TOKEN_FIELDS.filter((f) => {
    if (f.key === 'token_font_custom') return false; // driven by `token_font_body`
    if (f.key === 'token_scheme') return true; // reaches the page through `color-scheme`
    return variablesFor(f.key).some((v) => used.has(v));
  });
}

const ALIASES: Record<string, string[]> = {
  '--brand': ['--accent', '--primary', '--link', '--gold'],
  '--brand-alt': ['--accent-2', '--primary-2'],
  '--on-brand': ['--accent-fg', '--on-accent'],
  '--text': ['--fg', '--ink', '--body'],
  '--text-muted': ['--muted', '--muted-fg', '--subtle'],
  '--bg': ['--background', '--page', '--surface-page'],
  '--surface': ['--card', '--panel', '--soft'],
  '--line': ['--border', '--rule', '--divider'],
  '--radius': ['--r', '--radius-md', '--round'],
  '--font-body': ['--font', '--font-sans', '--serif', '--body-font'],
  '--font-head': ['--font-heading', '--headings', '--heading-font'],
  '--type-scale': ['--font-size', '--base-font-size'],
  '--width': ['--max', '--container', '--wrap', '--read'],
};
/**
 * Builds the `:root` block. Only variables the theme reads are emitted, so a
 * theme's dark-mode block for the same variable still wins where it is scoped
 * more specifically, and an unrelated theme is untouched.
 */
export function tokensCss(values: TokenValues, opts: { only?: Set<string> } = {}): string {
  const decls: string[] = [];
  /**
   * Emits `name` and every alias of it the theme reads. Themes name the same
   * idea differently (`--accent`, `--primary`, `--gold`), so a brand colour has
   * to reach whichever one this theme's stylesheet actually uses — and only
   * that one, or a theme's own fallback chain would never resolve.
   */
  const push = (name: string, value: string) => {
    const names = opts.only ? [name, ...(ALIASES[name] ?? [])].filter((n) => opts.only!.has(n)) : [name];
    for (const n of names) decls.push(`${n}:${value}`);
  };
  const v = values;

  if (v.token_brand) push('--brand', v.token_brand);
  if (v.token_brand_alt) push('--brand-alt', v.token_brand_alt);
  if (v.token_on_brand) push('--on-brand', v.token_on_brand);
  if (v.token_text) push('--text', v.token_text);
  if (v.token_text_muted) push('--text-muted', v.token_text_muted);
  if (v.token_bg) push('--bg', v.token_bg);
  if (v.token_surface) push('--surface', v.token_surface);
  if (v.token_line) push('--line', v.token_line);
  if (v.token_radius) push('--radius', `${v.token_radius}px`);

  // A body stack: the preset, or the author's own.
  const bodyStack = v.token_font_body === 'custom'
    ? (v.token_font_custom || '')
    : FONT_STACKS[v.token_font_body || 'system'];
  if (bodyStack) push('--font-body', bodyStack);
  if (v.token_font_head && v.token_font_head !== 'inherit') {
    const headStack = FONT_STACKS[v.token_font_head];
    if (headStack) push('--font-head', headStack);
  }
  if (v.token_type_scale) push('--type-scale', `${v.token_type_scale}px`);
  if (v.token_width) push('--width', `${v.token_width}rem`);

  return decls.length ? `:root{${decls.join(';')}}` : '';
}

/**
 * A theme's own value for a token's variable, so the Customizer can show
 * "theme default" instead of pretending its own hard-coded default is the truth.
 */
export function themeValue(css: string, fieldKey: string): string | null {
  for (const variable of variablesFor(fieldKey)) {
    const re = new RegExp(`${variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;}]+)`, 'i');
    const hit = css.match(re);
    if (hit) return hit[1].trim();
  }
  return null;
}

/**
 * "Always light" / "Always dark" are enforced with `color-scheme` on the page,
 * which every theme respects because they all use `prefers-color-scheme`.
 */
export function schemeMeta(value: string | undefined): string | null {
  if (value === 'light') return 'light';
  if (value === 'dark') return 'dark';
  return null;
}

/** Tokens that a colour-scheme override cannot honour (a theme sets its own colours). */
export const TOKEN_KEY_SET = new Set(ALL_TOKEN_FIELDS.map((f) => f.key));
export const tokenField = (key: string): TokenField | undefined => BY_KEY.get(key);
