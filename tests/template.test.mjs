// Template engine v2 (Phase 3): pure functions, so they are tested directly.
//
//   node --test tests/template.test.mjs
//
// Everything here is about a theme author's expectations: what a tag renders,
// what a missing value does, and which templates are rejected with a message a
// person can act on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, parseTemplate, inspectTemplate, formatDatePattern, filters } from '../dist/template.mjs';

const html = (src, data = {}, hooks = {}) => render(src, data, hooks);
const assetHook = { asset: (p) => `/theme-assets/journal/${p}` };

test('values: escaped by default, raw with three braces, objects never stringify', () => {
  assert.equal(html('{{a}}', { a: '<x>' }), '&lt;x&gt;');
  assert.equal(html('{{{a}}}', { a: '<x>' }), '<x>');
  assert.equal(html('{{a}}', { a: { b: 1 } }), '');
  assert.equal(html('{{a.b.c}}', { a: { b: { c: 'deep' } } }), 'deep');
  assert.equal(html('{{missing}}|{{missing.deep}}', {}), '|');
  assert.equal(html('{{ "a literal" }}', {}), 'a literal');
});

test('conditions: comparisons, and/or/not, parentheses, else', () => {
  assert.equal(html('{{#if n gt 3}}big{{else}}small{{/if}}', { n: 5 }), 'big');
  assert.equal(html('{{#if n gt 3}}big{{else}}small{{/if}}', { n: 2 }), 'small');
  assert.equal(html('{{#if a and (not b)}}y{{/if}}', { a: 1, b: 0 }), 'y');
  assert.equal(html('{{#if a or b}}y{{else}}n{{/if}}', { a: 0, b: 1 }), 'y');
  assert.equal(html('{{#if status eq "published"}}p{{/if}}', { status: 'published' }), 'p');
  assert.equal(html('{{#if n gte 3}}y{{/if}}', { n: 3 }), 'y');
  assert.equal(html('{{#unless hidden}}shown{{/unless}}', { hidden: false }), 'shown');
  assert.equal(html('{{#if n > 1}}y{{/if}}', { n: 2 }), 'y', 'symbol comparisons work too');
});

test('loops: index/first/last/key, limits, offsets, empty state, objects', () => {
  const rows = [{ title: 'a' }, { title: 'b' }, { title: 'c' }];
  assert.equal(html('{{#each rows}}{{@index}}:{{title}} {{/each}}', { rows }), '1:a 2:b 3:c ');
  assert.equal(html('{{#each rows}}{{#if @first}}first {{/if}}{{#if @last}}last{{/if}}{{/each}}', { rows }), 'first last');
  assert.equal(html('{{#each rows limit=2}}{{title}},{{/each}}', { rows }), 'a,b,');
  assert.equal(html('{{#each rows limit=1 offset=1}}{{title}},{{/each}}', { rows }), 'b,');
  assert.equal(html('{{#each rows}}x{{else}}none{{/each}}', { rows: [] }), 'none');
  assert.equal(html('{{#each bag}}{{@key}}={{this}} {{/each}}', { bag: { x: 1, y: 2 } }), 'x=1 y=2 ');
  // A field named "first" cannot shadow the loop helper.
  assert.equal(html('{{#each rows}}{{@first}}{{/each}}', { rows: [{ first: 'shadow' }] }), 'true');
});

test('filters: date, truncate, strip_html, slug, json, default, case, reading_time, number_format', () => {
  assert.equal(html('{{d | date "d MMM yyyy"}}', { d: '2026-03-09T10:00:00Z' }), '09 Mar 2026');
  assert.equal(html('{{d | date}}', { d: '2026-03-09T10:00:00Z' }), '09 Mar 2026', 'a sensible default pattern');
  assert.equal(html('{{t | truncate 10}}', { t: 'the quick brown fox' }), 'the quick…');
  assert.equal(html('{{h | strip_html}}', { h: '<p>Hi <b>there</b></p>' }), 'Hi there');
  assert.equal(html('{{t | slug}}', { t: 'Hello, World!' }), 'hello-world');
  assert.equal(html('{{o | json}}', { o: { a: 1 } }), '{"a":1}');
  assert.equal(html('{{x | default "none"}}', {}), 'none');
  assert.equal(html('{{x | upper}} {{x | lower}} {{x | capitalize}}', { x: 'héllo world' }), 'HÉLLO WORLD héllo world Héllo World');
  assert.equal(html('{{b | reading_time}}', { b: 'word '.repeat(400) }), '2');
  assert.equal(html('{{n | number_format}}', { n: 1234567.891 }), '1,234,567.891');
  assert.equal(html('{{n | number_format 2}}', { n: 1234567.891 }), '1,234,567.89');
  assert.equal(html('{{a | nope}}', { a: 'kept' }), 'kept', 'an unknown filter is a no-op, not a crash');
  assert.equal(html('{{t | truncate 10 | upper}}', { t: 'the quick brown fox' }), 'THE QUICK…', 'filters chain');
});

test('dates: token runs are one token, escapes pass through', () => {
  assert.equal(formatDatePattern('2026-01-02T03:04:00Z', 'Y-m-d H:i'), '2026-01-02 03:04');
  assert.equal(formatDatePattern('2026-01-02T00:00:00Z', 'j M Y'), '2 Jan 2026');
  assert.equal(formatDatePattern('2026-01-02T00:00:00Z', 'l, j F Y'), 'Friday, 2 January 2026');
  assert.equal(formatDatePattern('2026-01-02T00:00:00Z', '\\Y'), 'Y', 'a backslash escapes a token');
  assert.equal(formatDatePattern('not a date', 'Y'), 'not a date', 'an invalid date renders as it came');
});

test('partials: local, with a context, cross-theme, and the missing marker', () => {
  const hooks = { partial: (name) => (name === 'card' ? '<b>{{title}}</b>' : null) };
  assert.equal(html('{{> card}}', { title: 'T' }, hooks), '<b>T</b>');
  assert.equal(html('{{> card post}}', { post: { title: 'P' } }, hooks), '<b>P</b>');
  assert.equal(html('{{> missing}}', {}, hooks), '<!-- missing partial: missing -->');
  const cross = { partial: (name, _scope, crossTheme) => (crossTheme && name === 'footer' ? 'F' : null) };
  assert.equal(html('{{> @theme "footer"}}', {}, cross), 'F', '{{> @theme "x"}} reaches the parent theme');
});

test('assets: both spellings resolve to the same URL, and stay escaped in attributes', () => {
  assert.equal(html('{{{asset "logo.png"}}}', {}, assetHook), '/theme-assets/journal/logo.png');
  assert.equal(html('{{asset "logo.png"}}', {}, assetHook), '/theme-assets/journal/logo.png');
  assert.equal(html('{{ "logo.png" | asset }}', {}, assetHook), '/theme-assets/journal/logo.png');
  assert.equal(html('{{asset "nope.png"}}', {}, { asset: () => null }), '', 'a missing asset renders nothing');
});

test('layout blocks render their body, so a v2 layout keeps the page content', () => {
  assert.equal(html('<main>{{#block content}}</main>{{/block}}', { block: { content: '<p>page</p>' } }), '<main></main>',
    'a block renders its own body; the layout value comes from the page, not the tag');
  assert.equal(html('<main>{{{block.content}}}</main>', { block: { content: '<p>page</p>' } }), '<main><p>page</p></main>');
  assert.equal(html('<main>{{{content}}}</main>', { content: '<p>page</p>' }), '<main><p>page</p></main>', 'v1 themes keep working');
});

test('the parser reports what it cannot read instead of rendering nonsense', () => {
  assert.throws(() => parseTemplate('{{#if a}}never closed'), /never closed/);
  assert.throws(() => parseTemplate('{{#if a gt}}'), /Missing value/);
  assert.equal(inspectTemplate('{{a | weird}}').problems[0], 'Unknown filter "weird"');
  assert.deepEqual(inspectTemplate('{{a | upper}}').problems, []);
  assert.deepEqual(inspectTemplate('{{#each rows}}{{> card}}{{/each}}').partials, ['card']);
});

test('the filter list is what the docs claim', () => {
  for (const name of ['date', 'truncate', 'strip_html', 'slug', 'json', 'default', 'upper', 'lower', 'capitalize', 'reading_time', 'number_format', 'asset']) {
    assert.equal(typeof filters[name], 'function', `${name} is a filter`);
  }
});

test('a hostile template stays data: no expressions, no calls, no code', () => {
  // Anything that is not a path, a literal, a filter or a block is a parse
  // error, and a template that uses one is reported — never executed.
  for (const bad of ['{{process.exit(1)}}', '{{require("fs")}}', '{{a(); evil()}}']) {
    assert.throws(() => html(bad, {}), /Unexpected/, `${bad} is a parse error, not code`);
    assert.match(inspectTemplate(bad).problems[0], /Unexpected/);
  }
  for (const safe of ['{{constructor}}', '{{a.constructor}}']) {
    assert.doesNotThrow(() => html(safe, { a: {} }), `${safe} is inert`);
  }
  // `constructor`/`__proto__` resolve through own-property lookups only.
  assert.equal(html('{{__proto__}}', {}), '');
  assert.equal(html('{{a.constructor}}', { a: {} }), '');
});
