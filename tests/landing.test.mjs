// The landing screen's palette: pure functions, so they are tested directly.
//
//   node --test tests/landing.test.mjs
//
// The welcome screen has no colours of its own — it reads the active theme's
// stylesheet and the site's design tokens. These tests pin that reading, because
// a theme's `var(--token, fallback)` chains and its `:root` / dark-mode blocks
// are the one thing a wrong guess would show to every first-time visitor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { landingPalettes, landingCssVars, schemeLayers } from '../dist/landing.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const themeCss = (slug) => readFileSync(join(root, 'src', 'themes', slug, 'style.css'), 'utf8');
const look = (slug, scheme = null) => ({ css: themeCss(slug), scheme });

test('a theme\'s own palette is read through its var() chains, not invented', () => {
  // AMS Nova declares plain values on `:root`; the welcome screen reads them
  // straight out of the stylesheet rather than guessing.
  const nova = landingPalettes({}, look('nova')).light;
  assert.equal(nova.bg, '#f4f6fb');
  assert.equal(nova.fg, '#1a2238');
  assert.equal(nova.brand, '#e94560');
  assert.equal(nova.surface, '#ffffff');
  assert.equal(nova.radius, '14px', 'shapes are carried too');
});

test('every bundled theme resolves to a usable palette', () => {
  for (const slug of ['nova']) {
    const { light, dark } = landingPalettes({}, look(slug));
    for (const [name, palette] of [['light', light], ['dark', dark]]) {
      for (const key of ['bg', 'fg', 'muted', 'surface', 'line', 'brand', 'onBrand']) {
        assert.ok(palette[key], `${slug} ${name} ${key} is set`);
        assert.doesNotMatch(palette[key], /var\(/i, `${slug} ${name} ${key} is a value, not a reference`);
      }
      assert.ok(palette.font && !/[<>{};\\]/.test(palette.font), `${slug} ${name} font stack is safe`);
    }
  }
});

test('light and dark halves are read separately, and a light theme never gets dark copy', () => {
  const { light, dark, paired } = landingPalettes({}, look('nova'));
  assert.equal(paired, true, 'AMS Nova ships both halves');
  assert.equal(light.bg, '#f4f6fb');
  assert.equal(dark.bg, '#0d1320');
  assert.equal(dark.fg, '#e9edf7');

  // The last declaration in a block has no trailing semicolon; it still counts.
  const nova = landingPalettes({}, look('nova')).light;
  assert.equal(nova.brand, '#e94560');
  assert.equal(nova.radius, '14px');
});

test('a forced colour scheme collapses the pair, and a hand-switched theme is honoured', () => {
  const forcedLight = landingPalettes({}, look('nova', 'light'));
  assert.equal(forcedLight.paired, false, 'no media query when the site forces a scheme');
  assert.equal(forcedLight.light.bg, '#f4f6fb');

  const forcedDark = landingPalettes({}, look('nova', 'dark'));
  assert.equal(forcedDark.light.bg, '#0d1320', 'a forced dark site opens on the dark half');

  const css = landingCssVars(landingPalettes({}, look('nova')));
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{#ams-landing-screen\{/, 'the browser switch is mirrored');
  assert.match(css, /html\[data-ams-scheme="light"\] #ams-landing-screen\{/, "a theme's own toggle can say light");
  assert.match(css, /html\[data-ams-scheme="dark"\] #ams-landing-screen\{/, 'and dark');
});

test('design tokens win over the theme, and a readable ink is picked for the brand', () => {
  const tokens = {
    token_bg: '#102030', token_text: '#f0f0f0', token_brand: '#f7d64a',
    token_radius: '18', token_scheme: 'dark',
  };
  const palette = landingPalettes(tokens, look('nova')).light;
  assert.equal(palette.bg, '#102030', 'the admin background');
  assert.equal(palette.brand, '#f7d64a', 'the admin brand');
  assert.equal(palette.radius, '18px');

  // An unset surface is derived from the background rather than borrowed from
  // the other half of the theme.
  assert.match(palette.surface, /^color-mix\(in srgb, #102030 /);

  // Button ink is derived when the theme does not declare one: a pale gold
  // brand needs dark ink, a navy one needs white. (AMS Nova declares its own
  // `--on-brand`, so this uses a bare stylesheet to exercise the derivation.)
  const bare = { css: ':root{--bg:#102030;--text:#f0f0f0;--brand:#e94560}', scheme: 'dark' };
  assert.equal(landingPalettes({ token_brand: '#f7d64a' }, bare).light.onBrand, '#0b1220', 'button labels stay readable on a light brand');
  assert.equal(landingPalettes({ token_brand: '#1a3d8f' }, bare).light.onBrand, '#ffffff');
});

test('a stylesheet that is empty or hostile still yields something paintable', () => {
  const empty = landingPalettes({}, { css: '', scheme: null });
  assert.ok(empty.light.bg && empty.light.fg);
  assert.equal(empty.paired, false);

  // Values that would break out of a declaration are ignored, not passed on.
  const hostile = landingPalettes({}, {
    css: ':root{--bg:#fff;--accent:url(javascript:alert(1));--font:}</style><script>alert(1)</script>}',
    scheme: null,
  }).light;
  assert.equal(hostile.bg, '#ffffff', 'short hex is expanded');
  assert.equal(hostile.brand, '#2457d6', 'a refused accent falls back to the neutral one');
  assert.doesNotMatch(hostile.font, /script|<\/style/i);

  // The token values themselves are validated before they reach here (see
  // cleanTokens); anything odd is simply not a colour and is skipped.
  assert.doesNotMatch(landingCssVars(empty), /<|>/);
});

test('schemeLayers keeps the base declarations and unwraps only the dark block', () => {
  const layers = schemeLayers('a{--x:1}@media (prefers-color-scheme:dark){a{--x:2}}b{--y:3}');
  assert.match(layers.base, /--x:1/);
  assert.match(layers.base, /--y:3/);
  assert.doesNotMatch(layers.base, /--x:2/, 'the dark copy is not mistaken for the default');
  assert.match(layers.dark, /--x:2/);

  // A colon inside color-mix(… in srgb …) is not a media query.
  const mixed = schemeLayers('.a{background:color-mix(in srgb, #fff 50%, #000)}');
  assert.equal(mixed.dark, '');
  assert.match(mixed.base, /color-mix/);

  // Comments inside a block are not declarations and must not hide one.
  const commented = schemeLayers(':root{/* Surfaces */--bg:#f4f6fb}');
  assert.match(commented.base, /--bg:#f4f6fb/);
});
