import { esc } from './security';
import { FONT_STACKS } from './tokens';

export type LandingAudioTrack = { id: number; url: string; filename: string };

/**
 * Decode the ordered media IDs saved by Settings without trusting stored JSON. */
export function parseLandingAudioIds(value: string | undefined): number[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Two switches on the panel's Landing page screen. Both default to *on*, so an
 * install that never opened that screen keeps the splash and its play control;
 * only the stored string "0" turns anything off.
 */
export const landingEnabled = (settings: Record<string, string>): boolean => settings.landing_enabled !== '0';
export const landingPlayShown = (settings: Record<string, string>): boolean => settings.landing_play_button !== '0';

/**
 * The splash wears the active theme.
 *
 * Its palette comes from the same design tokens the rest of the site uses
 * (`token_bg`, `token_text`, `token_brand`…), so a brand colour set in
 * Appearance reaches the welcome screen too. A token the admin never set falls
 * back to the *theme's own* value — read straight out of its stylesheet — and
 * only then to this file's neutral pair, so the screen matches whichever theme
 * is active instead of always looking like the same dark navy card.
 *
 * Light themes get a light card and dark themes a dark one: the neutrals are
 * chosen from the background the visitor will actually see, so the copy is
 * never white-on-white. A theme that ships both halves gets both palettes, and
 * the same `prefers-color-scheme` switch its own stylesheet makes chooses one.
 */
export type LandingPalette = {
  bg: string;
  fg: string;
  muted: string;
  surface: string;
  line: string;
  brand: string;
  brandAlt: string;
  onBrand: string;
  radius: string;
  font: string;
};

/** What the active theme paints with, before any token overrides it. */
export type LandingThemeLook = {
  /** The theme's own stylesheet, so its palette can be read without guessing. */
  css: string;
  /** `light` / `dark` when the admin forced a scheme, else null (follow the visitor). */
  scheme: 'light' | 'dark' | null;
};

const SYSTEM_FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

const NEUTRAL_LIGHT: LandingPalette = {
  bg: '#ffffff', fg: '#141a26', muted: '#5b6678', surface: '#f5f7fb',
  line: '#e2e8f0', brand: '#2457d6', brandAlt: '#7c3aed', onBrand: '#ffffff',
  radius: '0.9rem', font: SYSTEM_FONT,
};
const NEUTRAL_DARK: LandingPalette = {
  bg: '#0d1117', fg: '#f2f5fa', muted: '#a3aec2', surface: '#161c26',
  line: '#2a3442', brand: '#8ab0ff', brandAlt: '#b79cff', onBrand: '#0b1220',
  radius: '0.9rem', font: SYSTEM_FONT,
};

/** A CSS colour we are willing to put in a style block: hex, or a plain rgb()/hsl(). */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/a-z]+\))$/i;

/** WCAG relative luminance, or null for a colour we cannot parse. */
function luminance(value: string): number | null {
  const hex = expandHex(value).replace('#', '');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Does this colour read as light? Decides which neutral pair carries the copy. */
function isLightColor(value: string): boolean {
  // The threshold asks for a genuinely light background, so a mid grey theme
  // still gets light copy rather than unreadable dark-on-grey.
  const l = luminance(value);
  return l !== null && l > 0.42;
}

/** Black or white, whichever is easier to read on `background`. */
function inkOn(background: string, light: string, dark: string): string {
  const l = luminance(background);
  if (l === null) return light;
  // (L + .05) / (.05) versus (1.05) / (L + .05): compare both contrast ratios.
  const withLight = 1.05 / (l + 0.05);
  const withDark = (l + 0.05) / 0.05;
  return withLight >= withDark ? light : dark;
}

/** `#abc` → `#aabbcc`; anything else is returned untouched. */
function expandHex(value: string): string {
  const v = value.trim();
  return /^#[0-9a-f]{3}$/i.test(v) ? '#' + v.slice(1).split('').map((c) => c + c).join('') : v;
}

const MEDIA_AT = /@media[^{]*\{/gi;

/**
 * Splits a theme's stylesheet into its base layer and whatever it declares
 * inside `@media (prefers-color-scheme: dark)`. Reading each layer on its own
 * is what lets the splash know a theme's light *and* dark palette; the dark
 * block is returned unwrapped so its declarations override the base ones
 * instead of being buried in a block CSS won't apply here.
 */
export function schemeLayers(css: string): { base: string; dark: string } {
  let base = '';
  let dark = '';
  let last = 0;
  for (const match of css.matchAll(MEDIA_AT)) {
    const start = match.index ?? 0;
    const open = start + match[0].length - 1;
    // The query ends at the first `{`, so a colon inside `color-mix(… in srgb …)`
    // elsewhere in the stylesheet can never be mistaken for a media query.
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    base += css.slice(last, start);
    const body = css.slice(open + 1, end);
    if (/prefers-color-scheme\s*:\s*dark/i.test(css.slice(start, open))) dark += body + '\n';
    else base += css.slice(start, end + 1);
    last = end + 1;
  }
  return { base: base + css.slice(last), dark };
}

/**
 * One stylesheet layer as a flat list of declarations, in source order.
 *
 * Selectors are dropped, because a selector that *names* a variable
 * (`:root:not([data-theme="light"]){…}`) must never be read as a declaration —
 * an earlier plain `:root` block is the layer's real default. Nested blocks (a
 * media query inside a layer) are flattened; nothing in a palette is nested
 * deeper than that.
 */
function declarations(layer: string): string[] {
  // Comments inside a block are not part of any declaration, and a comment
  // sitting right before one (`/* Surfaces */\n--bg: …`) would otherwise be
  // carried along with it and hide the declaration from the matcher below.
  const css = layer.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  let depth = 0;
  let buffer = '';
  for (const ch of css) {
    if (ch === '{') {
      // Whatever accumulated outside a block was selector text: throw it away.
      depth++;
      buffer = '';
      continue;
    }
    if (ch === '}') {
      // The last declaration in a block usually has no trailing semicolon, so it
      // is flushed here rather than dropped with the selector text.
      if (depth > 0 && buffer.includes(':')) out.push(buffer);
      depth = Math.max(0, depth - 1);
      buffer = '';
      continue;
    }
    if (depth === 0) continue;
    if (ch === ';') {
      if (buffer.includes(':')) out.push(buffer);
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  if (buffer.includes(':')) out.push(buffer);
  return out;
}

/** Splits `a, b, c` at commas that are not inside brackets or quotes. */
function splitTopLevel(text: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const ch of text) {
    if (quote) { current += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * `var(--brand, var(--accent, #9c4221))` → `#9c4221`.
 *
 * Themes name a variable for the site token and fall back to their own value,
 * sometimes through another variable, so the fallback list is read from the
 * inside out. A stack of fonts keeps all of its fallbacks (`var(--font, Georgia,
 * serif)` is the whole stack, not just `serif`).
 */
function resolveVar(value: string): string {
  const v = value.trim();
  if (!/^var\(/i.test(v)) return v;
  const open = v.indexOf('(');
  const close = v.lastIndexOf(')');
  if (close < open) return '';
  const [name, ...rest] = splitTopLevel(v.slice(open + 1, close));
  void name;
  const fallback = rest.join(',').trim();
  return fallback ? resolveVar(fallback) : '';
}

/**
 * Reads one custom property out of a stylesheet. The *first* literal
 * declaration wins: a theme writes its base palette on `:root` and any
 * `[data-theme="dark"]` copy after it, and the conditional copy must not be
 * mistaken for the default.
 */
function cssVar(css: string, names: string[]): string {
  const found = declarations(css);
  for (const name of names) {
    const re = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([\\s\\S]+)$`, 'i');
    for (const decl of found) {
      const match = decl.match(re);
      if (!match) continue;
      const value = resolveVar(match[1]).trim();
      if (value && !/^var\(/i.test(value)) return value;
    }
  }
  return '';
}

/** A colour we are willing to put in the screen's style block, or ''. */
const colorVar = (css: string, names: string[]): string => {
  const value = cssVar(css, names);
  return SAFE_COLOR.test(value) ? expandHex(value) : '';
};

const LENGTH = /^\d*\.?\d+(px|rem|em|%|vw|vh)$/i;
const lengthVar = (css: string, names: string[]): string => {
  const value = cssVar(css, names);
  return LENGTH.test(value) ? value : '';
};

/** The variables each idea is called in, across themes and their stylesheets. */
const NAMES = {
  bg: ['--bg', '--background', '--page', '--paper', '--surface-page', '--j-bg', '--p-bg', '--starter-paper'],
  fg: ['--text', '--fg', '--ink', '--body', '--j-ink', '--p-ink', '--starter-ink'],
  muted: ['--text-muted', '--muted', '--muted-fg', '--subtle', '--j-soft', '--p-soft', '--starter-muted'],
  surface: ['--surface', '--card', '--panel', '--soft', '--j-card', '--p-card', '--starter-card'],
  line: ['--line', '--border', '--rule', '--divider', '--j-line', '--p-line', '--starter-line'],
  brand: ['--brand', '--accent', '--primary', '--link', '--gold', '--j-accent', '--p-accent', '--starter-accent'],
  brandAlt: ['--brand-alt', '--accent-2', '--primary-2'],
  onBrand: ['--on-brand', '--accent-fg', '--on-accent', '--accent-ink'],
  radius: ['--radius', '--r', '--j-radius', '--p-radius'],
  font: ['--font-body', '--font', '--font-sans', '--j-font', '--p-font'],
};

/**
 * One palette: an admin token first, then whatever the active theme declares in
 * that layer, then the neutral pair matching the background that came out of it.
 */
function resolvePalette(tokens: Record<string, string>, layer: string): LandingPalette {
  const declaredBg = tokens.token_bg || colorVar(layer, NAMES.bg);
  const light = declaredBg ? isLightColor(declaredBg) : true;
  const neutral = light ? NEUTRAL_LIGHT : NEUTRAL_DARK;
  const pick = (token: string, names: string[], fallback: string): string => tokens[token] || colorVar(layer, names) || fallback;
  const palette: LandingPalette = {
    bg: declaredBg || neutral.bg,
    fg: pick('token_text', NAMES.fg, neutral.fg),
    muted: pick('token_text_muted', NAMES.muted, neutral.muted),
    surface: pick('token_surface', NAMES.surface, ''),
    line: pick('token_line', NAMES.line, neutral.line),
    brand: pick('token_brand', NAMES.brand, neutral.brand),
    brandAlt: pick('token_brand_alt', NAMES.brandAlt, neutral.brandAlt),
    onBrand: pick('token_on_brand', NAMES.onBrand, ''),
    radius: tokens.token_radius ? `${tokens.token_radius}px` : (lengthVar(layer, NAMES.radius) || neutral.radius),
    font: landingFont(tokens, layer),
  };
  // A button label that is readable on the brand colour, unless the admin picked
  // one: a gold or mint brand needs dark ink where a navy one needs white.
  if (!palette.onBrand) palette.onBrand = inkOn(palette.brand, '#ffffff', light ? '#11151f' : '#0b1220');
  // A surface or hairline that contradicts the background (a light card read
  // out of the base layer while this is the dark one) is worse than none, so it
  // is derived from the background instead of trusted.
  const surfaceClash = !!palette.surface && isLightColor(palette.surface) !== light;
  if (!palette.surface || surfaceClash || palette.surface.toLowerCase() === palette.bg.toLowerCase()) {
    palette.surface = `color-mix(in srgb, ${palette.bg} ${light ? '93%' : '80%'}, ${light ? '#000' : '#fff'})`;
  }
  if (palette.line && isLightColor(palette.line) !== light) {
    palette.line = `color-mix(in srgb, ${palette.fg} 18%, ${palette.bg})`;
  }
  return palette;
}

/** The body stack: the token preset, the author's own stack, or the theme's. */
function landingFont(tokens: Record<string, string>, layer: string): string {
  const choice = tokens.token_font_body;
  if (choice === 'custom' && tokens.token_font_custom) return tokens.token_font_custom;
  if (choice && FONT_STACKS[choice]) return FONT_STACKS[choice];
  // A stack out of a theme's stylesheet: fonts and fallbacks only, nothing that
  // could close the declaration it lands in.
  const stack = cssVar(layer, NAMES.font).replace(/[<>{};\\]/g, '').slice(0, 300);
  return stack || SYSTEM_FONT;
}

/**
 * The palettes the screen paints with: `light`, `dark`, and whether the theme
 * actually has two different ones. A forced scheme in Appearance collapses this
 * to a single block, exactly as it collapses the theme's own stylesheet.
 */
export function landingPalettes(tokens: Record<string, string>, look: LandingThemeLook): { light: LandingPalette; dark: LandingPalette; paired: boolean } {
  const { base, dark } = schemeLayers(look.css || '');
  const light = resolvePalette(tokens, base);
  // The dark layer goes first so its declarations win over the base ones.
  const darkPalette = resolvePalette(tokens, dark ? `${dark}\n${base}` : base);
  const forced = look.scheme;
  if (forced === 'light') return { light, dark: light, paired: false };
  if (forced === 'dark') return { light: darkPalette, dark: darkPalette, paired: false };
  return { light, dark: darkPalette, paired: JSON.stringify(light) !== JSON.stringify(darkPalette) };
}

/** A palette as the screen's own custom properties. */
function paletteVars(palette: LandingPalette): string {
  return [
    `--ams-bg:${palette.bg}`,
    `--ams-fg:${palette.fg}`,
    `--ams-muted:${palette.muted}`,
    `--ams-surface:${palette.surface}`,
    `--ams-line:${palette.line}`,
    `--ams-brand:${palette.brand}`,
    `--ams-brand-alt:${palette.brandAlt}`,
    `--ams-on-brand:${palette.onBrand}`,
    `--ams-radius:${palette.radius}`,
    `--ams-font:${palette.font}`,
  ].join(';');
}

/**
 * The palette rules. A theme with one palette emits one block; a theme with two
 * gets a second one inside the same `prefers-color-scheme` query its own
 * stylesheet uses, so the welcome screen and the home page behind it never
 * disagree about which half is showing.
 *
 * A theme can also be switched by hand (`html[data-theme="dark"]`, with the
 * site's own script flipping it), which a media query alone would miss. The
 * bootstrap mirrors that attribute onto the page as `data-ams-scheme`, and the
 * two rules below let it win over the browser's preference — a visitor who
 * picked dark on a light machine still gets a dark welcome screen.
 */
export function landingCssVars(palettes: { light: LandingPalette; dark: LandingPalette; paired: boolean }): string {
  const rule = (p: LandingPalette) => `#ams-landing-screen{${paletteVars(p)}}`;
  if (!palettes.paired) return rule(palettes.light);
  return [
    rule(palettes.light),
    `@media (prefers-color-scheme:dark){${rule(palettes.dark)}}`,
    `html[data-ams-scheme="light"] #ams-landing-screen{${paletteVars(palettes.light)}}`,
    `html[data-ams-scheme="dark"] #ams-landing-screen{${paletteVars(palettes.dark)}}`,
  ].join('\n');
}

/**
 * The splash is a fixed part of the public home response — it is never built
 * from a CMS Page or sample content. Its identity comes from saved settings
 * (site title, tagline and logo), its colours from the active theme and the
 * site's tokens, while its soundtrack is explicitly started by the visitor
 * (browsers commonly block audible autoplay). `head` decides whether the
 * splash is visible before the page paints; `body` supplies the accessible UI
 * and the looping playlist player.
 */
export function landingScreenMarkup(opts: {
  siteTitle: string;
  tagline: string;
  logoUrl: string;
  tracks: LandingAudioTrack[];
  /** False when the panel's Landing page screen hides the play control; the
   *  playlist is then left out entirely, so nothing is fetched or played. */
  showPlay: boolean;
  nonce: string;
  /** The active theme's own stylesheet and forced scheme, for the palette. */
  look?: LandingThemeLook;
  /** The site's design tokens (Appearance → Colours), already merged with any
   *  unsaved Customizer values. */
  tokens?: Record<string, string>;
}): { head: string; body: string } {
  const nonce = esc(opts.nonce);
  const palettes = landingPalettes(opts.tokens ?? {}, opts.look ?? { css: '', scheme: null });
  const hasTracks = opts.showPlay && opts.tracks.length > 0;
  const urls = JSON.stringify(hasTracks ? opts.tracks.map((track) => track.url) : []);
  const siteTitle = esc(opts.siteTitle.trim());
  const tagline = esc(opts.tagline.trim());
  const logo = opts.logoUrl.trim()
    ? `<img class="ams-landing-logo" src="${esc(opts.logoUrl.trim())}" alt="${siteTitle}">`
    : '';
  const copy = tagline ? `<p class="ams-landing-tagline">${tagline}</p>` : '';
  const status = hasTracks
    ? ''
    : 'No soundtrack has been added yet. Upload audio in Settings to enable playback.';

  const head = `<style nonce="${nonce}">${landingCssVars(palettes)}${LANDING_CSS}</style>
<script nonce="${nonce}">${LANDING_BOOTSTRAP}</script>`;
  const body = `<div class="ams-landing-screen" id="ams-landing-screen" role="dialog" aria-modal="true" aria-labelledby="ams-landing-title" data-audio-tracks="${esc(urls)}">
  <div class="ams-landing-card">
    ${logo}
    <p class="ams-landing-brand">Welcome to</p>
    <div class="ams-landing-copy">
      <h1 id="ams-landing-title">${siteTitle}</h1>
      ${copy}
    </div>
    ${opts.showPlay ? `<div class="ams-landing-equalizer" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
    ${status ? `<p class="ams-landing-status" id="ams-landing-status" role="status" aria-live="polite">${status}</p>` : ''}` : ''}
    ${opts.showPlay ? `<div class="ams-landing-transport">
      <button class="ams-landing-play" type="button" data-landing-play aria-label="Play soundtrack"${hasTracks ? '' : ' disabled'}>
        <svg class="ams-landing-icon ams-landing-icon-play" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.6 4.9a1 1 0 0 1 1.53-.84l10 7.1a1 1 0 0 1 0 1.68l-10 7.1a1 1 0 0 1-1.53-.84z"/></svg>
        <svg class="ams-landing-icon ams-landing-icon-pause" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.2 5h3.5v14H7.2zM13.3 5h3.5v14h-3.5z"/></svg>
      </button>
      <div class="ams-landing-secondary">
        ${hasTracks ? '<button class="ams-landing-mute" type="button" data-landing-mute aria-pressed="false">Mute sound</button>' : ''}
      </div>
    </div>` : ''}
    <button class="ams-landing-enter" type="button" data-landing-enter>Enter site</button>
    ${hasTracks ? '<p class="ams-landing-footnote">Your soundtrack will loop until you enter.</p>' : ''}
  </div>
  <audio class="ams-landing-audio" data-landing-audio preload="auto"></audio>
</div>
<script nonce="${nonce}">${LANDING_PLAYER}</script>`;
  return { head, body };
}

const LANDING_BOOTSTRAP = `(function(){
  var root=document.documentElement;
  // A theme switched by hand (html[data-theme]) overrides the browser's own
  // preference, so the screen is told which half to wear before it paints.
  function scheme(){
    var own=(root.getAttribute('data-theme')||'').toLowerCase();
    if(own==='dark'||own==='light')root.setAttribute('data-ams-scheme',own);
    else root.removeAttribute('data-ams-scheme');
  }
  try{scheme()}catch(e){}
  var forced=/(?:^|[?&])landing=1(?:&|$)/.test(location.search);var show=true;
  try{if(forced)sessionStorage.removeItem('ams-landing-entered');show=forced||sessionStorage.getItem('ams-landing-entered')!=='1'}catch(e){}
  if(show)root.setAttribute('data-ams-landing','show');
  // The theme's toggle may be pressed while the screen is up.
  try{new MutationObserver(scheme).observe(root,{attributes:true,attributeFilter:['data-theme']})}catch(e){}
})();`;

const LANDING_PLAYER = `(function(){
  var screen=document.getElementById('ams-landing-screen');
  if(!screen)return;
  var active=document.documentElement.getAttribute('data-ams-landing')==='show';
  var audio=screen.querySelector('[data-landing-audio]');
  var playButton=screen.querySelector('[data-landing-play]');
  var muteButton=screen.querySelector('[data-landing-mute]');
  var enterButton=screen.querySelector('[data-landing-enter]');
  var status=screen.querySelector('#ams-landing-status');
  var tracks=[];try{tracks=JSON.parse(screen.getAttribute('data-audio-tracks')||'[]')}catch(e){}
  if(!Array.isArray(tracks))tracks=[];
  // One track loops natively; a playlist loops by wrapping in the ended handler.
  audio.loop=tracks.length===1;
  var current=0;
  var muted=false;
  var card=screen.querySelector('.ams-landing-card');
  // Fetch the first track while the visitor is still reading the screen, so the
  // play gesture starts sound from the buffer instead of waiting for a download.
  // A discarded screen (this tab already entered) downloads nothing.
  function warm(){
    if(!tracks.length||audio.getAttribute('src'))return;
    audio.muted=muted;
    audio.preload='auto';
    audio.src=tracks[current];
  }
  function update(){
    var playing=!audio.paused;
    if(card)card.classList.toggle('is-playing',playing);
    if(playButton)playButton.setAttribute('aria-label',playing?'Pause soundtrack':'Play soundtrack');
    if(muteButton){muteButton.textContent=muted?'Unmute sound':'Mute sound';muteButton.setAttribute('aria-pressed',muted?'true':'false')}
    if(status&&tracks.length)status.textContent=playing?'':'Soundtrack paused. Press play to continue.';
  }
  function failed(){
    audio.pause();
    if(card)card.classList.remove('is-playing');
    update();
    if(status)status.textContent='This audio file could not be played. Try another format in Settings.';
  }
  function playTrack(index,attempts){
    if(!tracks.length)return;
    current=index%tracks.length;
    audio.src=tracks[current];
    audio.muted=muted;
    audio.load();
    audio.play().then(function(){if(status)status.textContent='';update()}).catch(function(){
      if(attempts>1)playTrack((current+1)%tracks.length,attempts-1);else failed();
    });
  }
  function start(){
    if(!tracks.length)return;
    // No source yet means warm() could not run: load, then play.
    if(!audio.getAttribute('src')){playTrack(current,tracks.length);return}
    // The warm source is already buffered, so this starts on the same task as
    // the click; if the file is unusable, fall through to the next track.
    audio.play().then(update).catch(function(){playTrack((current+1)%tracks.length,tracks.length-1)});
  }
  if(active&&playButton)warm();
  if(playButton)playButton.addEventListener('click',function(){if(audio.paused)start();else audio.pause()});
  if(muteButton)muteButton.addEventListener('click',function(){muted=!muted;audio.muted=muted;update()});
  audio.addEventListener('play',update);
  audio.addEventListener('pause',update);
  audio.addEventListener('ended',function(){
    if(!tracks.length)return;
    if(tracks.length===1){audio.currentTime=0;audio.play().catch(failed)}
    else playTrack((current+1)%tracks.length,tracks.length);
  });
  if(enterButton)enterButton.addEventListener('click',function(){
    audio.pause();
    try{audio.currentTime=0;audio.removeAttribute('src');audio.load()}catch(e){}
    try{
      sessionStorage.setItem('ams-landing-entered','1');
      var url=new URL(location.href);
      if(url.searchParams.get('landing')==='1'){
        url.searchParams.delete('landing');
        history.replaceState(null,'',url.pathname+url.search+url.hash);
      }
    }catch(e){}
    document.documentElement.removeAttribute('data-ams-landing');
    screen.remove();
    var main=document.getElementById('main');
    if(main){main.setAttribute('tabindex','-1');main.focus({preventScroll:true})}
  });
  if(active){
    var first=screen.querySelector('button:not([disabled])');if(first)first.focus({preventScroll:true});
    screen.addEventListener('keydown',function(event){
      if(event.key==='Escape'){event.preventDefault();if(enterButton)enterButton.click();return}
      if(event.key!=='Tab')return;
      var focusable=Array.prototype.slice.call(screen.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')).filter(function(el){return el.getClientRects().length>0});
      if(!focusable.length)return;
      var first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    });
  }
})();`;

/**
 * The screen's own layout. Every colour, radius and font is a custom property
 * set above from the active theme, so this stylesheet has no palette of its own.
 */
const LANDING_CSS = `
html[data-ams-landing="show"],html[data-ams-landing="show"] body{overflow:hidden}
.ams-landing-screen{display:none;position:fixed;z-index:2147483000;inset:0;place-items:center;overflow-y:auto;overscroll-behavior:contain;padding:clamp(1rem,4vw,3.5rem);background:radial-gradient(ellipse at 50% 0%,color-mix(in srgb,var(--ams-brand) 18%,transparent),transparent 60%),radial-gradient(ellipse at 100% 100%,color-mix(in srgb,var(--ams-brand-alt) 14%,transparent),transparent 55%),var(--ams-bg);color:var(--ams-fg);font:500 16px/1.6 var(--ams-font)}
html[data-ams-landing="show"] .ams-landing-screen{display:grid}
.ams-landing-card{display:flex;flex-direction:column;align-items:center;width:min(100%,42rem);margin:auto;padding:clamp(1.5rem,5vw,3.5rem);border:1px solid var(--ams-line);border-radius:calc(var(--ams-radius) * 2);background:var(--ams-surface);box-shadow:0 clamp(1rem,4vw,2rem) clamp(3rem,9vw,6rem) color-mix(in srgb,var(--ams-fg) 16%,transparent);text-align:center}
.ams-landing-logo{display:block;max-width:min(15rem,75%);max-height:5.5rem;width:auto;height:auto;margin:0 auto 1.25rem;object-fit:contain}
.ams-landing-brand{margin:0 0 1.3rem;color:var(--ams-brand);font-size:.75rem;font-weight:750;letter-spacing:.2em;text-transform:uppercase;overflow-wrap:anywhere}
.ams-landing-copy{width:100%;max-width:34rem;margin:0 auto}
.ams-landing-copy h1{margin:0 0 .75rem;color:var(--ams-fg);font-size:clamp(2rem,7vw,4.1rem);font-weight:750;letter-spacing:-.055em;line-height:1.04;overflow-wrap:anywhere}
.ams-landing-copy p{margin:.55rem 0;color:var(--ams-muted);font-size:clamp(.98rem,2.7vw,1.12rem)}
.ams-landing-tagline{overflow-wrap:anywhere}
.ams-landing-equalizer{height:3.3rem;display:flex;align-items:center;justify-content:center;gap:.28rem;margin:1.6rem auto .9rem}
.ams-landing-equalizer span{display:block;width:clamp(.2rem,1vw,.38rem);height:var(--bar-height,1rem);border-radius:99px;background:linear-gradient(180deg,var(--ams-brand),var(--ams-brand-alt));opacity:.7;transform-origin:center;animation:none}
.ams-landing-equalizer span:nth-child(1){--bar-height:1rem}.ams-landing-equalizer span:nth-child(2){--bar-height:2.1rem}.ams-landing-equalizer span:nth-child(3){--bar-height:2.8rem}.ams-landing-equalizer span:nth-child(4){--bar-height:1.5rem}.ams-landing-equalizer span:nth-child(5){--bar-height:2.4rem}.ams-landing-equalizer span:nth-child(6){--bar-height:3.1rem}.ams-landing-equalizer span:nth-child(7){--bar-height:2.2rem}.ams-landing-equalizer span:nth-child(8){--bar-height:1.3rem}.ams-landing-equalizer span:nth-child(9){--bar-height:2.6rem}.ams-landing-equalizer span:nth-child(10){--bar-height:1.8rem}.ams-landing-equalizer span:nth-child(11){--bar-height:1rem}
.ams-landing-card.is-playing .ams-landing-equalizer span{animation:ams-landing-bars .72s ease-in-out infinite alternate}
.ams-landing-card.is-playing .ams-landing-equalizer span:nth-child(2n){animation-duration:.54s;animation-delay:-.31s}.ams-landing-card.is-playing .ams-landing-equalizer span:nth-child(3n){animation-duration:.91s;animation-delay:-.58s}.ams-landing-card.is-playing .ams-landing-equalizer span:nth-child(5n){animation-delay:-.2s}
@keyframes ams-landing-bars{from{transform:scaleY(.2);opacity:.5}to{transform:scaleY(1);opacity:1}}
.ams-landing-status{min-height:1.6em;margin:0 0 1rem;color:var(--ams-muted);font-size:.86rem}
/* The play control has its own centred row, so a mute button beside it can
   never pull it off the card's axis. */
.ams-landing-transport{display:flex;flex-direction:column;align-items:center;gap:.8rem;width:100%;margin:0 auto}
.ams-landing-play,.ams-landing-mute,.ams-landing-enter{font:inherit;font-weight:700;cursor:pointer;transition:transform .18s ease,filter .18s ease,background-color .18s ease;border-radius:999px}
.ams-landing-play{display:grid;place-items:center;width:4.9rem;height:4.9rem;padding:0;border:0;border-radius:50%;color:var(--ams-on-brand);background:linear-gradient(140deg,color-mix(in srgb,var(--ams-brand) 72%,#fff),var(--ams-brand) 55%,var(--ams-brand-alt));box-shadow:0 .7rem 2.2rem color-mix(in srgb,var(--ams-brand) 32%,transparent),inset 0 1px rgba(255,255,255,.45)}
.ams-landing-play:hover:not(:disabled){transform:translateY(-2px);filter:brightness(1.06)}
.ams-landing-icon{display:block;width:1.95rem;height:1.95rem;fill:currentColor}
.ams-landing-icon-play{transform:translateX(.12rem)}
.ams-landing-icon-pause{display:none}
.ams-landing-card.is-playing .ams-landing-icon-play{display:none}
.ams-landing-card.is-playing .ams-landing-icon-pause{display:block}
.ams-landing-secondary{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:.6rem;min-height:2.75rem}
.ams-landing-mute,.ams-landing-enter{min-height:2.75rem;padding:.5rem 1rem;font-size:.9rem}
.ams-landing-mute{border:1px solid var(--ams-line);color:var(--ams-fg);background:color-mix(in srgb,var(--ams-fg) 6%,transparent)}
.ams-landing-mute:hover:not(:disabled){background:color-mix(in srgb,var(--ams-fg) 12%,transparent)}
/* Enter site: the primary action, and always centred on the card's own axis —
   its own row, one width, directly under the transport. */
.ams-landing-enter{display:block;margin:1.6rem auto 0;min-width:11rem;padding:.7rem 1.6rem;border:1px solid var(--ams-brand);background:var(--ams-brand);color:var(--ams-on-brand);text-align:center}
.ams-landing-enter:hover{filter:brightness(1.07)}
.ams-landing-enter:focus-visible,.ams-landing-play:focus-visible,.ams-landing-mute:focus-visible{outline:3px solid var(--ams-brand);outline-offset:3px}
.ams-landing-play:disabled,.ams-landing-mute:disabled{opacity:.55;cursor:not-allowed}
.ams-landing-footnote{margin:1.1rem 0 0;color:var(--ams-muted);font-size:.77rem}
.ams-landing-audio{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media(max-width:420px){.ams-landing-play{width:4.4rem;height:4.4rem}.ams-landing-card{padding:1.35rem 1.1rem}.ams-landing-equalizer{margin-top:1.2rem}.ams-landing-enter{width:100%;min-width:0}}
@media(prefers-reduced-motion:reduce){.ams-landing-play,.ams-landing-mute,.ams-landing-enter{transition:none}.ams-landing-card.is-playing .ams-landing-equalizer span{animation:none;transform:scaleY(.7)}}
`;
