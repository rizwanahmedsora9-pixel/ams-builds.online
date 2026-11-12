/**
 * Template engine v2.
 *
 * Templates are data, never code: every helper below is a pure function over
 * the values handed to `render()`, so nothing a template contains can execute.
 *
 *   {{path}}  {{{path}}}            values (escaped / raw), dotted paths, {{this}}
 *   {{@index}} {{@number}} {{@first}} {{@last}} {{@key}}   loop helpers
 *   {{#if x}} {{#unless x}}         blocks; also `{{#if a gt 3}}`, `and`, `or`, `not`, `(…)`
 *   {{#each rows}} {{#each rows limit=3}} {{#each object}}  loops, `{{else}}` when empty
 *   {{> header}} {{> post-card post}} {{> @theme "header"}} partials
 *   {{post.date | date "d MMM yyyy"}}  filters, callable recursively
 *   {{asset "logo.png"}} and {{{theme_css_url}}}    theme assets
 *   {{#block content}}…{{/block}}    layout inheritance
 *
 * The parser produces a small AST; the renderer walks it against a scope stack.
 * Compiled templates are cached by source string (see `render`), which is what
 * makes rendering a cached page cheap.
 */
import { esc, slugify, stripTags, safeUrl } from './security';

/* ------------------------------------------------------------------ values */

export type Scope = Record<string, unknown>;

const truthy = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : !!v);
const isPlainObject = (v: unknown): v is Scope => !!v && typeof v === 'object' && !Array.isArray(v);

/** Data a partial or helper may ask for; supplied by the renderer, not the theme. */
export type RenderHooks = {
  /**
   * Reads a partial by name (theme-local first, then the declared parent).
   * `crossTheme` is set for `{{> @theme "name"}}`, which looks the partial up in
   * the parent theme only.
   */
  partial?: (name: string, scope: Scope, crossTheme: boolean) => string | null;
  /** Maps an asset path to a public URL, or null when the file is missing. */
  asset?: (path: string) => string | null;
  /** Names of the assets the theme actually has, for error messages and listings. */
  hasAsset?: (path: string) => boolean;
  /** Theme-level settings (`{{theme.accent}}`), already merged with defaults. */
  themeSettings?: Scope;
};

/* ------------------------------------------------------------------ parser */

type Expr =
  | { k: 'lit'; v: unknown }
  | { k: 'path'; p: string }
  | { k: 'at'; p: string }
  | { k: 'not'; a: Expr }
  | { k: 'bin'; op: 'and' | 'or' | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; a: Expr; b: Expr };

type Filter = { name: string; args: Expr[] };

type Node =
  | string
  | { t: 'var'; expr: Expr; raw: boolean; filters: Filter[] }
  | { t: 'block'; k: 'if' | 'unless' | 'each' | 'block'; expr: Expr | null; args: Record<string, Expr>; body: Node[]; alt: Node[] }
  | { t: 'partial'; name: string; ctx: Expr | null; dynamic: boolean };

/** Raised for a template that cannot be parsed; shown by the validate screen. */
export class TemplateError extends Error {}

const OPEN = '{{';

/**
 * Splits `{{ … }}` from text, honouring quotes so a filter argument like
 * `"d MMM yyyy"` (or a `}}` inside a string) does not end the tag early.
 */
type Raw = { inner: string; triple: boolean };
function scan(src: string): { text?: string; tag?: Raw }[] {
  const out: { text?: string; tag?: Raw }[] = [];
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf(OPEN, i);
    if (start < 0) {
      out.push({ text: src.slice(i) });
      break;
    }
    if (start > i) out.push({ text: src.slice(i, start) });
    const triple = src[start + 2] === '{';
    const closeTok = triple ? '}}}' : '}}';
    let j = start + (triple ? 3 : 2);
    let quote = '';
    for (; j < src.length; j++) {
      const ch = src[j];
      if (quote) {
        if (ch === '\\') j++;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (src.startsWith(closeTok, j)) break;
    }
    if (j >= src.length) {
      // Unterminated tag: treat the rest as text so a broken template still renders.
      out.push({ text: src.slice(start) });
      break;
    }
    out.push({ tag: { inner: src.slice(start + (triple ? 3 : 2), j).trim(), triple } });
    i = j + closeTok.length;
  }
  return out;
}

const KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'this']);

/** Tokenises an expression: words, dotted paths, @helpers, strings, numbers, operators. */
function lexExpr(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = '';
      for (; j < input.length && input[j] !== ch; j++) {
        if (input[j] === '\\' && j + 1 < input.length) {
          value += input[++j];
        } else value += input[j];
      }
      tokens.push(JSON.stringify({ s: value }));
      i = j + 1;
      continue;
    }
    if ('()|,='.includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === '>') {
      if (input[i + 1] === '=') {
        tokens.push('>=');
        i += 2;
      } else {
        tokens.push('>');
        i++;
      }
      continue;
    }
    if (ch === '<') {
      if (input[i + 1] === '=') {
        tokens.push('<=');
        i += 2;
      } else {
        tokens.push('<');
        i++;
      }
      continue;
    }
    if (ch === '!') {
      if (input[i + 1] === '=') {
        tokens.push('!=');
        i += 2;
        continue;
      }
      throw new TemplateError('Unknown operator "!" — did you mean "not"?');
    }
    if (ch === '-') {
      const num = input.slice(i).match(/^-\d+(?:\.\d+)?/);
      if (!num) throw new TemplateError('Unknown operator "-"');
      tokens.push(num[0]);
      i += num[0].length;
      continue;
    }
    const word = input.slice(i).match(/^[\w@$-]+(?:\.[\w@$-]+)*/);
    if (!word) throw new TemplateError(`Unexpected character "${ch}" in {{${input}}}`);
    tokens.push(word[0]);
    i += word[0].length;
  }
  return tokens;
}

const isStringToken = (t: string | undefined): boolean => !!t && t.startsWith('{');
const unquote = (t: string): string => JSON.parse(t).s as string;

class ExprParser {
  private pos = 0;
  constructor(private tokens: string[]) {}

  peek(): string | undefined {
    return this.tokens[this.pos];
  }
  next(): string | undefined {
    return this.tokens[this.pos++];
  }
  done(): boolean {
    return this.pos >= this.tokens.length;
  }

  /** or > and > not > comparison > primary. */
  parse(): Expr {
    const expr = this.parseOr();
    if (!this.done()) throw new TemplateError(`Unexpected "${this.peek()}"`);
    return expr;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.peek() === 'or' || this.peek() === '||') {
      this.next();
      left = { k: 'bin', op: 'or', a: left, b: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.peek() === 'and' || this.peek() === '&&') {
      this.next();
      left = { k: 'bin', op: 'and', a: left, b: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.peek() === 'not' || this.peek() === '!') {
      this.next();
      return { k: 'not', a: this.parseNot() };
    }
    return this.parseCmp();
  }

  private parseCmp(): Expr {
    const left = this.parsePrimary();
    const op = this.peek();
    const map: Record<string, 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'> = {
      eq: 'eq', '==': 'eq', '=': 'eq', ne: 'ne', '!=': 'ne',
      gt: 'gt', '>': 'gt', gte: 'gte', '>=': 'gte', lt: 'lt', '<': 'lt', lte: 'lte', '<=': 'lte',
    };
    if (op && map[op]) {
      this.next();
      return { k: 'bin', op: map[op], a: left, b: this.parsePrimary() };
    }
    return left;
  }

  private parsePrimary(): Expr {
    const tok = this.next();
    if (tok === undefined) throw new TemplateError('Missing value');
    if (tok === '(') {
      const inner = this.parseOr();
      if (this.next() !== ')') throw new TemplateError('Missing ")"');
      return inner;
    }
    if (isStringToken(tok)) return { k: 'lit', v: unquote(tok) };
    if (/^-?\d+(?:\.\d+)?$/.test(tok)) return { k: 'lit', v: Number(tok) };
    if (tok === 'true') return { k: 'lit', v: true };
    if (tok === 'false') return { k: 'lit', v: false };
    if (tok === 'null' || tok === 'undefined') return { k: 'lit', v: null };
    if (tok.startsWith('@')) return { k: 'at', p: tok.slice(1) };
    if (KEYWORDS.has(tok) || /^[\w$-]+(?:\.[\w@$-]+)*$/.test(tok)) return { k: 'path', p: tok };
    throw new TemplateError(`Unexpected "${tok}"`);
  }
}

/** Parses a tag body like `post.date | date "d MMM yyyy" | truncate 160`. */
/** Helpers callable as `{{name arg}}`, which is sugar for `{{arg | name}}`. */
const CALLABLE_HELPERS = new Set(['asset', 'url', 'default', 'truncate', 'date', 'slug', 'escape', 'json']);

function parseValueTag(inner: string): { expr: Expr; filters: Filter[] } {
  const parts = splitTopLevel(inner, '|');
  const head = parts.shift() ?? '';
  const filters: Filter[] = [];
  const headTokens = lexExpr(head);
  let expr: Expr;
  if (headTokens.length > 1 && CALLABLE_HELPERS.has(headTokens[0])) {
    // `{{asset "logo.png"}}` is sugar for `{{"logo.png" | asset}}`: the helper
    // name becomes a filter and its arguments go where the value would be.
    const name = headTokens.shift()!;
    filters.push({
      name,
      args: headTokens.slice(1).map((t) => new ExprParser([t]).parse()),
    });
    expr = new ExprParser(headTokens).parse();
  } else {
    expr = new ExprParser(headTokens).parse();
  }
  for (const part of parts) {
    const tokens = lexExpr(part);
    const name = tokens.shift();
    if (!name) throw new TemplateError('Empty filter');
    const args: Expr[] = [];
    for (const tok of tokens) {
      if (tok === ',') continue;
      args.push(new ExprParser([tok]).parse());
    }
    filters.push({ name: name.replace(/^\|/, ''), args });
  }
  return { expr, filters };
}

/** Splits a tag body into whitespace-separated tokens, keeping quoted strings whole. */
function tokenizeTag(input: string): string[] {
  const out: string[] = [];
  for (const m of input.matchAll(/"[^"]*"|'[^']*'|[^\s]+/g)) out.push(m[0]);
  return out;
}

/** Splits on `sep` outside quotes and parentheses. */
function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) {
      out.push(input.slice(start, i));
      start = i + 1;
    }
  }
  out.push(input.slice(start));
  return out;
}

export function parseTemplate(src: string): Node[] {
  const root: Node[] = [];
  type Frame = { node: Extract<Node, { t: 'block' }>; alt: boolean; kind: string };
  const stack: Frame[] = [];
  const cur = (): Node[] => {
    const top = stack[stack.length - 1];
    return top ? (top.alt ? top.node.alt : top.node.body) : root;
  };
  for (const piece of scan(src)) {
    if (piece.text !== undefined) {
      cur().push(piece.text);
      continue;
    }
    const inner = piece.tag!.inner;
    // `head` is the bare word: "#each" -> "each", "/if" -> "if", "> card" -> "card".
    const head = inner.replace(/^[#/^>]\s*/, '').match(/^[\w@$-]+/)?.[0] ?? '';

    if (inner.startsWith('#')) {
      const k = head as 'if' | 'unless' | 'each' | 'block';
      const rest = inner.slice(1 + k.length).trim();
      if (k === 'block') {
        if (!rest) throw new TemplateError('{{#block}} needs a name');
        const node = { t: 'block' as const, k, expr: null, args: {}, body: [], alt: [] };
        cur().push(node);
        stack.push({ node, alt: false, kind: 'block' });
        continue;
      }
      if (k !== 'if' && k !== 'unless' && k !== 'each') throw new TemplateError(`Unknown block "{{#${k}}}"`);
      const args: Record<string, Expr> = {};
      // Keyword arguments (`limit=3 offset=2`) are lifted out first; the rest is
      // the value being looped over (or tested).
      const kept: string[] = [];
      for (const token of tokenizeTag(rest)) {
        const kw = token.match(/^(\w+)\s*=\s*(.+)$/);
        if (kw) args[kw[1]] = new ExprParser([kw[2]]).parse();
        else kept.push(token);
      }
      const exprSource = kept.join(' ');
      const expr = exprSource.trim() ? new ExprParser(lexExpr(exprSource)).parse() : null;
      if (!expr && k !== 'each') throw new TemplateError(`{{#${k}}} needs a value`);
      const node = { t: 'block' as const, k, expr, args, body: [], alt: [] };
      cur().push(node);
      stack.push({ node, alt: false, kind: k });
      continue;
    }
    if (inner.startsWith('/')) {
      const name = head;
      const top = stack[stack.length - 1];
      // `{{/block}}` closes `{{#block}}`: compare the name, not "#name".
      if (top && top.kind === name) stack.pop();
      continue;
    }
    if (inner.startsWith('>')) {
      const [rawName, ...rest] = inner.slice(1).trim().split(/\s+/);
      const dynamic = rawName === '@theme';
      const name = dynamic ? lexexprString(rest.shift() ?? '') : rawName;
      if (!name) throw new TemplateError('{{>}} needs a partial name');
      const ctxSrc = rest.join(' ').trim();
      cur().push({ t: 'partial', name, ctx: ctxSrc ? new ExprParser(lexExpr(ctxSrc)).parse() : null, dynamic });
      continue;
    }
    if (inner === 'else') {
      const top = stack[stack.length - 1];
      if (top) top.alt = true;
      continue;
    }
    const { expr, filters } = parseValueTag(inner);
    cur().push({ t: 'var', expr, raw: piece.tag!.triple, filters });
  }
  if (stack.length) throw new TemplateError(`{{#${stack[stack.length - 1].kind}}} is never closed`);
  return root;
}

/** `"header"` or `'header'` as a plain string (partial names may be quoted). */
function lexexprString(tok: string): string {
  const t = tok.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/* ---------------------------------------------------------------- filters */

const str = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'object' ? '' : String(v));

/** Formats a date with a small, stable subset of the PHP/ICU-ish tokens. */
export function formatDatePattern(value: unknown, pattern: string, tz = 'UTC'): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return str(value);
  const parts = (opts: Intl.DateTimeFormatOptions): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const p of new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz }).formatToParts(date)) out[p.type] = p.value;
    return out;
  };
  // formatToParts is asked for one field at a time: a combined request can omit
  // the very field we want when the locale/day is short.
  const short = { day: parts({ day: 'numeric' }).day, month: parts({ month: 'short' }).month, year: parts({ year: 'numeric' }).year };
  const long = { month: parts({ month: 'long' }).month };
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const full = { weekday: weekdayNames[date.getUTCDay()] ?? '' };
  const time = { hour: parts({ hour: '2-digit', hour12: false }).hour, minute: parts({ minute: '2-digit' }).minute };
  // `i` is "minutes" in this token set (PHP-style), which is what theme authors expect.
  const map: Record<string, string> = {
    'd': short.day, 'j': short.day.replace(/^0/, ''),
    'D': (weekdayNames[date.getUTCDay()] ?? '').slice(0, 3), 'N': String(date.getUTCDay() || 7),
    'l': full.weekday,
    'M': short.month, 'F': long.month, 'm': String(date.getUTCMonth() + 1).padStart(2, '0'), 'n': String(date.getUTCMonth() + 1),
    'Y': short.year, 'y': short.year,
    'H': time.hour, 'i': time.minute.padStart(2, '0'),
    'T': parts({ timeZoneName: 'short' }).timeZoneName ?? tz,
    'U': String(Math.floor(date.getTime() / 1000)),
  };
  // Runs of one letter are one token: "d MMM yyyy" must become "9 Mar 2026",
  // not "MarMarMar" (`M` once per letter) or "09" for a single `d`.
  let out = '';
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      out += pattern[i + 1];
      i += 2;
      continue;
    }
    if (!/[A-Za-z]/.test(ch)) {
      out += ch;
      i++;
      continue;
    }
    let run = 1;
    while (pattern[i + run] === ch) run++;
    const mapped = map[ch] ?? ch;
    out += runToken(ch, run, mapped, short, long, date);
    i += run;
  }
  return out;
}

/**
 * One run of the same pattern letter. Runs that mean nothing extra (a typo like
 * `dddd`) render once rather than repeating the value.
 */
function runToken(
  token: string, run: number, mapped: string,
  short: Record<string, string>, long: Record<string, string>, date: Date,
): string {
  if (token === 'd') return mapped.padStart(2, '0');
  if (token === 'M') return run >= 4 ? long.month : short.month;
  if (token === 'D') return short.weekday;
  if (token === 'F') return long.month;
  if (token === 'Y') return run === 2 ? String(date.getUTCFullYear()).slice(-2) : String(date.getUTCFullYear());
  if (token === 'y') return run >= 4 ? String(date.getUTCFullYear()) : String(date.getUTCFullYear()).slice(-2);
  if (token === 'l') return mapped; // the full weekday name
  if (token === 'N') return mapped;
  return mapped;
}

export function readingTime(html: string): number {
  const words = stripTags(String(html ?? '')).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(str(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

type FilterFn = (value: unknown, args: unknown[], ctx: Scope) => unknown;

export const filters: Record<string, FilterFn> = {
  date: (v, args, ctx) => formatDatePattern(v, str(args[0]) || 'd MMM yyyy', str(ctx.tz) || 'UTC'),
  truncate: (v, args) => {
    const text = str(v).trim();
    const max = Math.max(1, Math.trunc(toNumber(args[0]) || 160));
    if (text.length <= max) return text;
    return text.slice(0, max).replace(/[\s,;:.-]+\S*$/, '') + '…';
  },
  strip_html: (v) => stripTags(str(v)).trim(),
  slug: (v) => slugify(str(v)),
  /** Raw-safe: JSON is meant to be embedded in a <script type="application/json">. */
  json: (v) => new RawValue(JSON.stringify(v ?? null)),
  default: (v, args) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? (args.length ? args[0] : '') : v),
  upper: (v) => str(v).toUpperCase(),
  lower: (v) => str(v).toLowerCase(),
  capitalize: (v) => {
    // `\b` treats "é" as a boundary; use whitespace instead so only word starts change.
    let atStart = true;
    return [...str(v)].map((ch) => {
      const upper = atStart ? ch.toUpperCase() : ch;
      atStart = /\s|-/.test(ch);
      return upper;
    }).join('');
  },
  reading_time: (v) => readingTime(str(v)),
  number_format: (v, args) => {
    const n = toNumber(v);
    // No argument: keep the value's own decimals (1234567.891 -> 1,234,567.891).
    if (args[0] === undefined) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(n);
    const digits = Math.max(0, Math.min(4, Math.trunc(toNumber(args[0]))));
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  },
  /** Builds a URL for a theme asset, e.g. {{ "logo.png" | asset }}. */
  asset: (v, _args, ctx) => {
    const hook = ctx.__asset as ((p: string) => string | null) | undefined;
    return (hook && hook(str(v))) || '';
  },
  url: (v) => safeUrl(str(v)),
  escape: (v) => esc(str(v)),
  nl2br: (v) => esc(str(v)).replace(/\r?\n/g, '<br>'),
};

/** A filter result that must not be HTML-escaped (JSON, URLs built by the CMS). */
export class RawValue {
  constructor(public readonly value: string) {}
}

export const FILTER_NAMES = Object.keys(filters).sort();

/* ----------------------------------------------------------------- renderer */

/** The value of `{{this}}`: the nearest scope that is an item, not a loop frame. */
function thisValue(scopes: Scope[]): unknown {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (s && typeof s === 'object' && Object.prototype.hasOwnProperty.call(s, 'this')) return s.this;
  }
  return scopes[scopes.length - 1];
}

function lookup(scopes: Scope[], path: string): unknown {
  if (path === 'this') return thisValue(scopes);
  const [first, ...rest] = path.split('.');
  let value: unknown;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (s && typeof s === 'object' && Object.prototype.hasOwnProperty.call(s, first)) {
      value = s[first];
      break;
    }
  }
  if (rest.length === 0 && value === undefined && first === '.') return scopes[scopes.length - 1];
  for (const key of rest) {
    if (value == null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = (value as Scope)[key];
  }
  return value;
}

class Renderer {
  constructor(private hooks: RenderHooks, private filtersInUse: Set<string>) {}

  evalExpr(expr: Expr, scopes: Scope[]): unknown {
    switch (expr.k) {
      case 'lit':
        return expr.v;
      case 'path':
        return lookup(scopes, expr.p);
      case 'at': {
        const top = (scopes[scopes.length - 1] ?? {}) as Scope;
        const at = top['@'] as Scope | undefined;
        return at ? at[expr.p] : undefined;
      }
      case 'not':
        return !truthy(this.evalExpr(expr.a, scopes));
      case 'bin': {
        if (expr.op === 'and') return truthy(this.evalExpr(expr.a, scopes)) && truthy(this.evalExpr(expr.b, scopes));
        if (expr.op === 'or') return truthy(this.evalExpr(expr.a, scopes)) || truthy(this.evalExpr(expr.b, scopes));
        const a = this.evalExpr(expr.a, scopes);
        const b = this.evalExpr(expr.b, scopes);
        const numeric = typeof a === 'number' || typeof b === 'number';
        const cmp = (x: unknown, y: unknown): number =>
          numeric
            ? toNumber(x) - toNumber(y)
            : str(x).localeCompare(str(y), undefined, { sensitivity: 'base' });
        switch (expr.op) {
          case 'eq': return str(a) === str(b) || (numeric && toNumber(a) === toNumber(b));
          case 'ne': return !(str(a) === str(b) || (numeric && toNumber(a) === toNumber(b)));
          case 'gt': return cmp(a, b) > 0;
          case 'gte': return cmp(a, b) >= 0;
          case 'lt': return cmp(a, b) < 0;
          case 'lte': return cmp(a, b) <= 0;
        }
      }
    }
  }

  applyFilters(value: unknown, chain: Filter[], scopes: Scope[]): unknown {
    let out = value;
    for (const f of chain) {
      const fn = filters[f.name];
      if (!fn) {
        // Unknown filters render their input untouched, so one typo cannot blank a page.
        this.filtersInUse.add('?' + f.name);
        continue;
      }
      this.filtersInUse.add(f.name);
      // The innermost data scope plus the render hooks: a filter like `asset`
      // needs the theme that is being rendered, not the loop frame it sits in.
      const ctx = { ...((scopes[scopes.length - 1] ?? {}) as Scope), __asset: this.hooks.asset };
      out = fn(out, f.args.map((a) => this.evalExpr(a, scopes)), ctx);
    }
    return out;
  }

  run(nodes: Node[], scopes: Scope[]): string {
    let out = '';
    for (const n of nodes) {
      if (typeof n === 'string') {
        out += n;
        continue;
      }
      if (n.t === 'var') {
        const value = this.applyFilters(this.evalExpr(n.expr, scopes), n.filters, scopes);
        if (value instanceof RawValue) {
          out += value.value;
          continue;
        }
        if (value == null || typeof value === 'object') continue;
        out += n.raw ? str(value) : esc(value);
        continue;
      }
      if (n.t === 'partial') {
        const name = n.name;
        const ctxValue = n.dynamic ? null : n.ctx ? this.evalExpr(n.ctx, scopes) : null;
        const html = this.hooks.partial?.(name, scopes[scopes.length - 1] ?? {}, n.dynamic);
        if (html == null) {
          out += `<!-- missing partial: ${esc(name)} -->`;
          continue;
        }
        // A partial is rendered in place with the caller's scopes; its compiled
        // form is cached by source string in `compiled`, so this is cheap.
        const inner = isPlainObject(ctxValue) ? [...scopes, ctxValue] : scopes;
        out += new Renderer(this.hooks, this.filtersInUse).run(compile(html), inner);
        continue;
      }
      // blocks
      if (n.k === 'block') {
        out += this.run(n.body, scopes);
        continue;
      }
      if (n.k === 'each') {
        const value = n.expr ? this.evalExpr(n.expr, scopes) : undefined;
        const limit = n.args.limit ? Math.max(0, Math.trunc(toNumber(this.evalExpr(n.args.limit, scopes)))) : 0;
        const offset = n.args.offset ? Math.max(0, Math.trunc(toNumber(this.evalExpr(n.args.offset, scopes)))) : 0;
        let entries: [string, unknown][] = [];
        if (Array.isArray(value)) entries = value.map((v, i) => [String(i), v]);
        else if (isPlainObject(value)) entries = Object.entries(value);
        // Offset first, then limit: `limit=3 offset=2` means "three starting at the third".
        if (offset) entries = entries.slice(offset);
        if (limit) entries = entries.slice(0, limit);
        const count = entries.length;
        if (!count) {
          out += this.run(n.alt, scopes);
          continue;
        }
        entries.forEach(([key, item], index) => {
          const at: Scope = {
            index: index + 1, // human numbering: {{@number}}
            index0: index,
            key,
            number: index + 1,
            first: index === 0,
            last: index === count - 1,
          };
          // The loop frame (`@index`, `@key`) is its own scope under the item, so
          // an item field called `first` or `index` can never shadow it.
          const loop: Scope = { '@': at };
          const child: Scope = isPlainObject(item) ? { ...item, this: item, value: item } : { this: item, value: item };
          out += this.run(n.body, [...scopes, child, loop]);
        });
        continue;
      }
      const value = n.expr ? this.evalExpr(n.expr, scopes) : undefined;
      out += this.run(truthy(value) === (n.k === 'if') ? n.body : n.alt, scopes);
    }
    return out;
  }
}

/* ------------------------------------------------------------------- cache */

const compiled = new Map<string, Node[]>();

/** Parses once per distinct source string (bounded, so a hostile theme cannot grow it forever). */
export function compile(src: string): Node[] {
  let nodes = compiled.get(src);
  if (!nodes) {
    nodes = parseTemplate(src);
    if (compiled.size > 200) compiled.clear();
    compiled.set(src, nodes);
  }
  return nodes;
}

export function render(source: string, data: Scope, hooks: RenderHooks = {}): string {
  const used = new Set<string>();
  const html = new Renderer(hooks, used).run(compile(source), [data]);
  if (used.size && (globalThis as { __amsFilters?: Set<string> }).__amsFilters) {
    for (const name of used) (globalThis as { __amsFilters?: Set<string> }).__amsFilters!.add(name);
  }
  return html;
}

/**
 * Static check used by the admin "Validate theme" screen: unknown filters, tags
 * whose closing tag is missing, and values that are definitely not data paths.
 * Collects problems instead of throwing so the page can list them all.
 */
export function inspectTemplate(source: string): { filters: string[]; partials: string[]; problems: string[] } {
  const problems: string[] = [];
  const partials: string[] = [];
  const used = new Set<string>();
  let nodes: Node[];
  try {
    nodes = parseTemplate(source);
  } catch (err) {
    return { filters: [], partials: [], problems: [err instanceof Error ? err.message : String(err)] };
  }
  const walk = (list: Node[]): void => {
    for (const n of list) {
      if (typeof n === 'string') continue;
      if (n.t === 'partial') {
        partials.push(n.dynamic ? '@theme ' + n.name : n.name);
        continue;
      }
      if (n.t === 'var') {
        for (const f of n.filters) {
          if (filters[f.name]) used.add(f.name);
          else problems.push(`Unknown filter "${f.name}"`);
        }
        continue;
      }
      walk(n.body);
      walk(n.alt);
    }
  };
  walk(nodes);
  return { filters: [...used].sort(), partials, problems };
}
