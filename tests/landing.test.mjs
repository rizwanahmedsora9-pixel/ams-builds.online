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
  // AMS 1 declares plain values; AMS Portfolio nestles every colour in
  // `var(--bg, #0e1116)`, so the literal fallback is what has to come out.
  const ams1 = landingPalettes({}, look('ams1')).light;
  assert.equal(ams1.bg, '#ffffff');
  assert.equal(ams1.fg, '#0f1b2d');
  assert.equal(ams1.brand, '#1a5cff');
  assert.equal(ams1.surface, '#f5f8fc');

  const portfolio = landingPalettes({}, look('portfolio')).light;
  assert.equal(portfolio.bg, '#0e1116', 'the dark fallback, not the token name');
  assert.equal(portfolio.fg, '#f2f4f8');
  assert.equal(portfolio.brand, '#22d3a6');
  assert.equal(portfolio.radius, '14px', 'shapes are carried too');
});

test('every bundled theme resolves to a usable palette', () => {
  for (const slug of ['ams1', 'default', 'journal', 'portfolio', 'pro', 'premium']) {
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
  const { light, dark, paired } = landingPalettes({}, look('default'));
  assert.equal(paired, true, 'AMS Base ships both halves');
  assert.equal(light.bg, '#ffffff');
  assert.equal(dark.bg, '#11151c');
  assert.equal(dark.fg, '#e6e9ef');

  // A theme with one palette needs no second block.
  assert.equal(landingPalettes({}, look('portfolio')).paired, false);

  // The last declaration in a block has no trailing semicolon; it still counts
  // (`premium` ends its `:root` with `--serif:…`).
  const premium = landingPalettes({}, look('premium')).light;
  assert.equal(premium.bg, '#faf8f3');
  assert.equal(premium.brand, '#b8860b');
  assert.equal(premium.radius, '.5rem');
});

test('a forced colour scheme collapses the pair, and a hand-switched theme is honoured', () => {
  const forcedLight = landingPalettes({}, look('default', 'light'));
  assert.equal(forcedLight.paired, false, 'no media query when the site forces a scheme');
  assert.equal(forcedLight.light.bg, '#ffffff');

  const forcedDark = landingPalettes({}, look('default', 'dark'));
  assert.equal(forcedDark.light.bg, '#11151c', 'a forced dark site opens on the dark half');

  const css = landingCssVars(landingPalettes({}, look('ams1')));
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{#ams-landing-screen\{/, 'the browser switch is mirrored');
  assert.match(css, /html\[data-ams-scheme="light"\] #ams-landing-screen\{/, "a theme's own toggle can say light");
  assert.match(css, /html\[data-ams-scheme="dark"\] #ams-landing-screen\{/, 'and dark');
});

test('design tokens win over the theme, and a readable ink is picked for the brand', () => {
  const tokens = {
    token_bg: '#102030', token_text: '#f0f0f0', token_brand: '#f7d64a',
    token_radius: '18', token_scheme: 'dark',
  };
  const palette = landingPalettes(tokens, look('default')).light;
  assert.equal(palette.bg, '#102030', 'the admin background');
  assert.equal(palette.brand, '#f7d64a', 'the admin brand');
  assert.equal(palette.radius, '18px');
  // A pale gold button needs dark ink; a navy one would have needed white.
  assert.equal(palette.onBrand, '#0b1220', 'button labels stay readable on a light brand');
  assert.equal(landingPalettes({ token_brand: '#1a3d8f' }, look('default')).light.onBrand, '#ffffff');

  // An unset surface is derived from the background rather than borrowed from
  // the other half of the theme.
  assert.match(palette.surface, /^color-mix\(in srgb, #102030 /);
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
});
