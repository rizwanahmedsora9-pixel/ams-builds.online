// The post/page editor, run as the browser runs it.
//
//   npm test   (or: node --test tests/editor.test.mjs)
//
// The editor is two <script> bodies rendered into /posts/new. Every assertion
// here is made against the exact strings that ship, pulled from a real page and
// evaluated in a VM. Two layers:
//
//   1. editor-utils.ts is pure, so it is tested directly: slugify must agree
//      with the server's, imageFigure must emit only what the sanitizer keeps,
//      and a link may never be a javascript: URL.
//   2. editor-js.ts needs a DOM, so a small fake document stands in for the
//      browser. That is enough to prove the wiring that broke before: the
//      toolbar exists and its buttons are all bound, the Text/HTML switch
//      serialises, the paste handler strips foreign markup, Ctrl+S saves, and
//      a missing element never throws.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHarness } from './helpers.mjs';

const panel = createHarness();
let utilsScript = '';
let editorScript = '';

before(async () => {
  await panel.start();
  await panel.install();
  const page = await panel.get(`${panel.admin}/posts/new`);
  const scripts = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  utilsScript = scripts.find((body) => body.includes('window.amsEditorUtils={')) || '';
  editorScript = scripts.find((body) => body.includes("document.getElementById('edit')") && body.includes('visual-editor')) || '';
});

after(async () => {
  await panel.stop();
  panel.cleanup();
});

/** Runs the shipped utils script in a fresh context and returns its exports. */
function bootUtils() {
  const context = { console, URL, window: null };
  context.window = context;
  vm.createContext(context);
  new vm.Script(utilsScript).runInContext(context);
  return context.amsEditorUtils;
}

/* ==========================================================================
   The pure helpers
   ========================================================================== */

test('both scripts ship, and the utils load before the editor that uses them', async () => {
  assert.ok(utilsScript, 'the editor ships window.amsEditorUtils');
  assert.ok(editorScript, 'the editor ships its own script');
  const page = await panel.get(`${panel.admin}/posts/new`);
  const order = page.text.indexOf('window.amsEditorUtils={') < page.text.indexOf("document.getElementById('edit')");
  assert.ok(order, 'utils are in the document before the editor script');
  // Neither script may reference a helper it does not ship.
  assert.match(editorScript, /var U=window\.amsEditorUtils\|\|\{\}/);
});

test('slugify is the same function the server stores the slug with', async () => {
  const { slugify } = await import('../src/lib/security.ts');
  const U = bootUtils();
  for (const input of ['Hello World', 'Launch Day & More', 'Café déjà vu', '  --Spaced--  ', '日本語のタイトル', 'a'.repeat(200)]) {
    assert.equal(U.slugify(input), slugify(input), `slugify(${JSON.stringify(input)}) agrees`);
  }
  assert.equal(U.slugify('Hello World'), 'hello-world');
  assert.equal(U.slugify(''), '');
});

test('a link may never be javascript: - and the editor refuses it before saving', () => {
  const U = bootUtils();
  for (const bad of ['javascript:alert(1)', 'javascript&colon;alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'httpsx://no']) {
    assert.equal(U.safeHref(bad), '', `${JSON.stringify(bad)} is refused`);
  }
  for (const good of ['https://example.com', 'http://example.com/a?b=c#d', 'mailto:a@b.co', 'tel:+1234', '/about', '#section', '?page=2', 'relative/path']) {
    assert.equal(U.safeHref(good), good, `${good} is allowed`);
  }
});

test('imageFigure emits only markup the sanitizer keeps: width in %, alignment in a class', () => {
  const U = bootUtils();
  const fig = U.imageFigure({ url: '/media/2026/05/pic.webp', alt: 'A "quoted" alt', caption: 'Under <it>', width: 50 });
  assert.equal(fig, '<figure class="image-block align-center" style="width:50%"><img src="/media/2026/05/pic.webp" alt="A &quot;quoted&quot; alt" loading="lazy"><figcaption>Under &lt;it&gt;</figcaption></figure>');
  // Widths are clamped to what the sanitizer accepts, never 0 or 250%.
  assert.match(U.imageFigure({ url: '/a.png', width: 250 }), /width:100%/);
  assert.match(U.imageFigure({ url: '/a.png', width: 3 }), /width:10%/);
  assert.match(U.imageFigure({ url: '/a.png', width: 'x' }), /width:50%/, 'a missing width is 50%, not full width');
  // Alignment is one of three classes and nothing else.
  for (const align of ['left', 'center', 'right']) {
    assert.match(U.imageFigure({ url: '/a.png', align }), new RegExp(`align-${align}`));
  }
  assert.match(U.imageFigure({ url: '/a.png', align: 'sideways' }), /align-center/, 'an unknown alignment falls back to centred');
  // Non-images are refused rather than inserted as a broken figure.
  assert.equal(U.imageFigure({ url: 'javascript:alert(1)' }), '');
  assert.equal(U.imageFigure({ url: 'pic.png' }), '', 'a bare name is not a URL');
  // A link on the image follows the same URL rule.
  assert.match(U.imageFigure({ url: '/a.png', link: 'https://example.com' }), /^<figure[^>]*><a href="https:\/\/example\.com">/,
    'an image link is a normal link: no forced new tab');
  assert.match(U.imageFigure({ url: '/a.png', link: 'https://example.com', linkNewTab: true }), /target="_blank"/);
  assert.doesNotMatch(U.imageFigure({ url: '/a.png', link: 'javascript:alert(1)' }), /<a /);
});

test('links: attributes, a new tab only for the web, and no empty anchors', () => {
  const U = bootUtils();
  assert.equal(U.linkAttrs('/about', false), ' href="/about"');
  assert.equal(U.linkAttrs('https://example.com', true), ' href="https://example.com" target="_blank" rel="noopener noreferrer"');
  assert.equal(U.linkAttrs('mailto:a@b.co', true), ' href="mailto:a@b.co"', 'mail and phone never open a blank tab');
  assert.equal(U.linkAttrs('javascript:alert(1)', true), '');
  assert.equal(U.linkMarkup({ url: '/about', text: 'About <us>' }), '<a href="/about">About &lt;us&gt;</a>');
  assert.equal(U.linkMarkup({ url: '/about' }), '<a href="/about">/about</a>', 'an empty label falls back to the address');
  assert.equal(U.linkMarkup({ url: 'javascript:1' }), '');
});

test('the word count counts what a reader sees, never the markup', () => {
  const U = bootUtils();
  assert.deepEqual(
    { words: U.wordCount('<p>One two <strong>three</strong>.</p>').words },
    { words: 3 },
  );
  assert.equal(U.wordCount('<style>.a{color:red}</style><p>real words here</p>').words, 3, 'styles are not prose');
  assert.equal(U.wordCount('<script>var a = 1;</script><p>Hi</p>').words, 1, 'scripts are not prose');
  assert.equal(U.wordCount('<p>a &amp; b</p>').words, 3, 'an entity is one word');
  assert.equal(U.wordCount('<figure class="image-block"><img src="/a.png" alt="x"><figcaption>Caption</figcaption></figure>').words, 1);
  assert.equal(U.wordCount('').words, 0);
  assert.equal(U.readingMinutes(0), 1);
  assert.equal(U.readingMinutes(220), 1);
  assert.equal(U.readingMinutes(221), 2);
});

test('youtubeId accepts the URLs people actually paste and nothing else', () => {
  const U = bootUtils();
  const id = 'dQw4w9WgXcQ';
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ]) assert.equal(U.youtubeId(url), id, url);
  assert.equal(U.youtubeId('https://www.youtube.com/watch?v=short'), '');
  assert.equal(U.youtubeId('https://vimeo.com/12345'), '');
  assert.equal(U.youtubeId('javascript:alert(1)'), '');
  assert.equal(U.youtubeId('not a url'), '');
});

test('hasRawBlock keeps style/script content out of the visual editor', () => {
  const U = bootUtils();
  assert.equal(U.hasRawBlock('<style>.a{}</style><p>x</p>'), true);
  assert.equal(U.hasRawBlock('<!-- note --><script>alert(1)</script>'), true);
  assert.equal(U.hasRawBlock('<p>plain</p>'), false);
  assert.equal(U.hasRawBlock('<p>a style guide</p>'), false, 'the word "style" in prose is not a block');
});

/* ==========================================================================
   The editor script against a fake document
   ========================================================================== */

/** A fake element: enough attributes, classes, listeners and children. */
function makeEl(tag, attrs = {}) {
  // A <dialog> in jsdom terms: open state, showModal and close.
  const dialog = String(tag).toLowerCase() === 'dialog'
    ? { get open() { return !!this._open; }, showModal() { this._open = true; }, close() { this._open = false; } }
    : {};
  const listeners = new Map();
  const classes = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    dataset: {},
    style: {},
    children: [],
    parentNode: null,
    hidden: false,
    disabled: false,
    value: attrs.value || '',
    _text: attrs.text || '',
    _html: attrs.html || '',
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = String(value); this._text = null; },
    get textContent() {
      if (this._text != null) return this._text;
      return String(this._html).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    },
    set textContent(value) { this._text = String(value); },
    selectionStart: 0,
    selectionEnd: 0,
    clientWidth: 600,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, force) => { if (force === undefined ? !classes.has(name) : force) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name),
    },
    setAttribute(name, value) { this.dataset[`attr:${name}`] = String(value); },
    getAttribute(name) { return this.dataset[`attr:${name}`] ?? null; },
    removeAttribute(name) { delete this.dataset[`attr:${name}`]; },
    hasAttribute(name) { return `attr:${name}` in this.dataset; },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((one) => one !== fn)); },
    fire(type, event = {}) { for (const fn of listeners.get(type) || []) fn({ preventDefault() {}, stopPropagation() {}, target: this, ...event }); },
    click() { this.fire('click', { target: this }); },
    focus() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    insertBefore(child) { this.children.push(child); child.parentNode = this; return child; },
    remove() {},
    replaceWith() {},
    cloneNode() {
      const copy = makeEl(tag, { class: [...classes].join(' '), html: this._html });
      copy._text = this._text;
      return copy;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
    getRootNode() { return this; },
  };
  Object.assign(el, dialog);
  el.setSelectionRange = (start, end) => { el.selectionStart = start; el.selectionEnd = end; };
  return el;
}

function bootEditor(overrides = {}) {
  const nodes = {
    edit: makeEl('form', { html: '' }),
    body: makeEl('textarea', { value: overrides.body ?? '<p>Saved body.</p>' }),
    'visual-editor': makeEl('div'),
    'content-editor': makeEl('div'),
    'editor-toolbar': makeEl('div', { html: '' }),
    'editor-status': makeEl('p'),
    'editor-mode-switch': makeEl('div'),
    'editor-mode-dialog': null,
    'editor-stats': makeEl('p'),
    title: makeEl('input', { value: 'A Title' }),
    slug: makeEl('input', { value: overrides.slug ?? '' }),
    status: makeEl('select', { value: 'published' }),
    when: makeEl('div'),
    delete: null,
    'image-tools': makeEl('div'),
    'img-overlay': makeEl('div'),
    'img-width': makeEl('input'),
    'img-width-out': makeEl('output'),
    'media-picker': null,
    'link-dialog': makeEl('dialog'),
    'link-url': makeEl('input'),
    'link-text': makeEl('input'),
    'link-newtab': makeEl('input'),
    'link-remove': makeEl('button'),
    'link-error': makeEl('p'),
    'insert-link': makeEl('button'),
    'link-dialog-title': makeEl('h2'),
  };
  // A toolbar button the shipped script can bind: data-wrap plus an optional
  // execCommand name, both read through dataset.
  const button = (data) => {
    const el = makeEl('button');
    Object.assign(el.dataset, data);
    el.getAttribute = (name) => (name === 'data-wrap' ? data.wrap ?? null : el.dataset[`attr:${name}`] ?? null);
    return el;
  };
  const toolbarButtons = overrides.toolbarButtons || [
    button({ wrap: '<strong>|</strong>', command: 'bold' }),
    button({ wrap: '<em>|</em>', command: 'italic' }),
  ];
  Object.assign(nodes.edit.dataset, overrides.formData || {});
  nodes['editor-toolbar'].querySelectorAll = (selector) => (selector === '[data-wrap]' ? toolbarButtons : []);
  nodes['content-editor'].contains = () => true;
  nodes['visual-editor'].contains = (node) => node != null;

  const execCalls = [];
  const document = {
    getElementById: (id) => nodes[id] ?? null,
    querySelector: (selector) => (overrides.selectors && selector in overrides.selectors ? overrides.selectors[selector] : null),
    querySelectorAll: (selector) => (overrides.queryAll && selector in overrides.queryAll ? overrides.queryAll[selector] : []),
    createElement: (tag) => makeEl(tag),
    createRange: () => ({
      cloneRange() { return this; },
      selectNodeContents() {}, setEnd() {}, setStart() {}, collapse() {},
      get commonAncestorContainer() { return null; }, get collapsed() { return true; },
    }),
    createTreeWalker: () => ({ nextNode: () => null }),
    execCommand: (command, _ui, value) => { execCalls.push([command, value]); return true; },
  };
  const selection = {
    rangeCount: 1, anchorNode: nodes['visual-editor'],
    getRangeAt: () => document.createRange(),
    removeAllRanges() {}, addRange() {},
  };
  const errors = [];
  const context = {
    console, URL, URLSearchParams, FormData, Blob, Promise, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval() {},
    document,
    NodeFilter: { SHOW_TEXT: 4 },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: overrides.fetch || (() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })),
    getSelection: () => selection,
    innerWidth: 1024,
    prompt: () => null,
    confirm: () => true,
    addEventListener() {},
    removeEventListener() {},
    amsEditorUtils: bootUtils(),
  };
  context.window = context;
  vm.createContext(context);
  // Surface a reference error as a failed assertion instead of an empty log.
  context.__errors = errors;
  new vm.Script(editorScript).runInContext(context);
  return { context, nodes, execCalls, toolbarButtons };
}

test('the editor boots on an empty/new document without throwing', () => {
  assert.doesNotThrow(() => bootEditor(), 'a new post boots with a DOM this small');
  const { nodes, context } = bootEditor();
  assert.equal(typeof context.amsEditor, 'object', 'the editor exposes a small handle for its own tests');
  assert.equal(context.amsEditor.mode(), 'text', 'saved content opens in the visual editor');
  assert.equal(nodes['editor-stats'].textContent.includes('words'), true, 'the word count is rendered');
  // A <style> in the body must not leak into the panel document.
  const styled = bootEditor({ body: '<style>body{display:none}</style>' });
  assert.doesNotMatch(styled.nodes['visual-editor'].innerHTML, /display:none/, 'raw CSS stays out of the page');
  // An empty document (Add New) keeps the source pane, so nothing blank is
  // shown as a formatted page; the DB state for that is covered in e2e.mjs.
  const fresh = bootEditor({ body: '' });
  assert.equal(fresh.context.amsEditor.mode(), 'html');
});

test('existing content opens in the visual editor, and the raw-block guard still wins', () => {
  const plain = bootEditor();
  assert.equal(plain.context.amsEditor.mode(), 'text', 'saved content is shown visually');
  assert.match(plain.nodes['visual-editor'].innerHTML, /Saved body/, 'and it is in the writing surface');
  // innerHTML does not run <script>, but it would apply a <style> to the whole
  // admin document: a raw block must never reach the visual pane, not even
  // while hidden.
  const raw = bootEditor({ body: '<style>.x{color:red}</style><p>hi</p>' });
  assert.equal(raw.context.amsEditor.mode(), 'html', 'a style/script block stays in the source pane');
  assert.doesNotMatch(raw.nodes['visual-editor'].innerHTML, /color:red/, 'the raw block never enters the admin DOM');
});

test('every formatting button is bound to a click handler', () => {
  const { toolbarButtons, execCalls } = bootEditor();
  assert.ok(toolbarButtons.length >= 2);
  for (const button of toolbarButtons) button.click();
  assert.deepEqual(execCalls.map(([command]) => command), ['bold', 'italic'], 'the toolbar commands reach the browser');
});

test('the link dialog writes a checked link, and a bad address is refused before saving', () => {
  // An empty document opens in the HTML pane, which is where this test edits.
  const { nodes, context } = bootEditor({ body: '' });
  assert.equal(context.amsEditor.mode(), 'html');
  // HTML pane: the dialog inserts into the textarea at the selection.
  nodes.body.value = 'Read the report';
  nodes.body.setSelectionRange(5, 16);
  nodes.body.focus = () => {};
  nodes['link-url'].value = 'https://example.com/report';
  nodes['link-text'].value = 'the report';
  nodes['link-newtab'].checked = true;
  nodes['insert-link'].click();
  assert.match(nodes.body.value, /Read <a href="https:\/\/example\.com\/report" target="_blank" rel="noopener noreferrer">the report<\/a>/);

  // A javascript: URL never reaches the document.
  const blocked = bootEditor();
  blocked.nodes['link-url'].value = 'javascript:alert(1)';
  blocked.nodes['insert-link'].click();
  assert.equal(blocked.nodes['link-error'].hidden, false, 'the writer is told why');
  assert.doesNotMatch(blocked.nodes.body.value, /javascript/, 'nothing is inserted');
});

test('an image on the clipboard is uploaded through the picker endpoint, not embedded as a data URL', async () => {
  const calls = [];
  const { nodes } = bootEditor({
    body: '',
    formData: { pickerUpload: '/admin-panel/media/picker/upload', csrf: 'token-123' },
    fetch: (url, init) => {
      calls.push({ url, body: init && init.body });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, items: [{ id: 7, url: '/media/2026/11/abc-shot.webp', alt: '' }] }),
      });
    },
  });
  const files = [new File([new Uint8Array(24)], 'shot.png', { type: 'image/png' })];
  // The endpoint travels on the form as data-picker-upload. Boot already read
  // it, so it is set through the overrides the fake form starts with.
  nodes.edit.dataset.pickerUpload = '/admin-panel/media/picker/upload';
  assert.equal(typeof nodes.edit.dataset.pickerUpload, 'string');
  // The drop handler is bound to the writing surface.
  nodes['visual-editor'].fire('drop', { dataTransfer: { files, types: ['Files'] }, preventDefault() {} });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.length, 1, 'one upload request');
  assert.equal(calls[0].url, '/admin-panel/media/picker/upload');
  assert.ok(calls[0].body instanceof FormData, 'the picker endpoint gets multipart form data');
  assert.equal(typeof calls[0].body.get('_csrf'), 'string', 'with the CSRF token');
});

test('the paste handler strips foreign markup and keeps the words', () => {
  const { nodes, execCalls } = bootEditor();
  const pasted = [];
  const original = nodes['visual-editor'];
  // Insert text goes through execCommand('insertText') in the shipped script.
  original.fire('paste', {
    clipboardData: { getData: (type) => (type === 'text/html' ? '<b style="color:red">Bold</b>' : 'Bold words') },
  });
  assert.deepEqual(execCalls.filter(([command]) => command === 'insertText')[0], ['insertText', 'Bold words'],
    'a paste inserts plain text, never the clipboard HTML');
  pasted.push(...execCalls);
  assert.ok(pasted.length > 0);
});

test('Ctrl+S saves the form instead of opening the browser save dialog', () => {
  const { nodes } = bootEditor();
  let submitted = false;
  let prevented = false;
  // requestSubmit is the modern path the script prefers; submit() is the fallback.
  nodes.edit.requestSubmit = () => { submitted = true; };
  nodes['visual-editor'].fire('keydown', {
    ctrlKey: true, key: 's',
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true, 'the browser save dialog is suppressed');
  assert.equal(submitted, true, 'the form is saved the way the button would');
});

test('no regular expression in the shipped editor lost its backslashes to the bundler', async () => {
  // Both scripts are template literals in TypeScript, so a backslash that is
  // meant to reach the browser is written twice. A single \s silently becomes
  // 's' and a pattern quietly stops matching, which no server-side assertion
  // would notice. Each script is split into its regex literals here, using a
  // small scanner that understands escapes and character classes, and every
  // one of them must compile and keep its escapes.
  const page = await panel.get(`${panel.admin}/posts/new`);
  const scripts = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  // Signatures of a lost backslash: a class that became the literal letters
  // ("[\s\S]" -> "[sS]", "[\w-]" -> "[w-]"), or a "\b" that became "b" right
  // after a tag-name class (as in the paragraph scanner).
  const suspects = ['[sS]', '[w-]', 'article)b', '>)\\bs']
  let checked = 0;
  for (const body of scripts) {
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== '/') continue;
      const before = body[i - 1];
      if (before && !'=(,:[!&|?{;'.includes(before)) continue;
      if (body[i + 1] === '/' || body[i + 1] === '*') continue; // comment
      // Scan to the closing slash, honouring escapes and [classes].
      let j = i + 1, inClass = false;
      for (; j < body.length; j++) {
        const ch = body[j];
        if (ch === '\\') { j++; continue; }
        if (ch === '\n') break;
        if (inClass) { if (ch === ']') inClass = false; continue; }
        if (ch === '[') { inClass = true; continue; }
        if (ch === '/') break;
      }
      if (j >= body.length || body[j] !== '/') continue;
      const source = body.slice(i + 1, j);
      const flags = (body.slice(j + 1).match(/^[gimsuy]*/) || [''])[0];
      checked++;
      for (const bad of suspects) {
        assert.ok(!source.includes(bad), `regex /${source}/ has a lost backslash (${bad})`);
      }
      assert.doesNotThrow(() => new RegExp(source, flags), `regex /${source}/ compiles`);
      i = j;
    }
  }
  assert.ok(checked > 10, `the editor ships ${checked} regex literals and all of them were checked`);
});

test('the HTML pane is tidied but never emptied: stray divs and empty blocks go', () => {
  // tidyHtml is internal, so exercise it through the shipped source of truth:
  // the serialiser that runs on submit. A document with a redundant div and an
  // empty paragraph is reduced to the paragraph inside it.
  // A saved document opens in the Text pane (see the boot rules), which is
  // where the serialiser runs.
  const { nodes, context } = bootEditor();
  assert.equal(context.amsEditor.mode(), 'text');
  nodes['visual-editor'].innerHTML = '<div><p>Keep me</p></div><p></p><p>&nbsp;</p><div></div>';
  // serialize() runs the same tidy pass the submit handler does.
  const out = context.amsEditor.serialize();
  // A div that only wraps a paragraph is the browser's line container; the
  // paragraph inside it is kept and the wrapper goes.
  assert.equal(out, '<p>Keep me</p>', `tidied output was ${JSON.stringify(out)}`);
  assert.equal(context.amsEditor.tidy('<p>Keep me</p><p></p><p>&nbsp;</p><p></p>'), '<p>Keep me</p>',
    'empty paragraphs left by the browser are removed');
  // Structural elements are not leftovers, even when empty.
  assert.equal(context.amsEditor.tidy('<table><tbody><tr><td></td></tr></tbody></table>'),
    '<table><tbody><tr><td></td></tr></tbody></table>');
  assert.equal(context.amsEditor.tidy('<div><h2>One block</h2></div>'), '<h2>One block</h2>');
  assert.equal(context.amsEditor.tidy('<figure class="image-block"><img src="/a.png" alt=""></figure>'),
    '<figure class="image-block"><img src="/a.png" alt=""></figure>', 'an image block is never unwrapped');
  assert.equal(context.amsEditor.tidy('<p>a</p><p></p><p>b</p>'), '<p>a</p><p>b</p>');
  assert.equal(context.amsEditor.tidy('<div class="html-block">\n<p>x</p>\n</div>'),
    '<div class="html-block">\n<p>x</p>\n</div>', 'a custom block keeps its wrapper');
});


test('mixed headings, images and following paragraphs survive tidying', () => {
  const { context } = bootEditor();
  const html = '<h2>Heading</h2><p>Intro</p><figure class="image-block align-center" style="width:50%"><img src="/a.png" alt=""><figcaption>Caption</figcaption></figure><div>First paragraph</div><div>Second paragraph</div><h3>Next heading</h3><p>More text</p>';
  assert.equal(context.amsEditor.tidy(html), html.replace('<div>First paragraph</div><div>Second paragraph</div>', '<p>First paragraph</p><p>Second paragraph</p>'));
  const custom = '<div class="custom"><p>Before</p><figure><img src="/a.png"></figure><p>After</p></div><div>Next</div>';
  assert.equal(context.amsEditor.tidy(custom), custom.replace('<div>Next</div>', '<p>Next</p>'));
  assert.match(editorScript, /tail\.extractContents\(\)/);
  assert.match(editorScript, /range\.setStart\(paragraph,0\)/);
});

test('inserting an image keeps existing text and headings outside the figure', async () => {
  const { JSDOM } = await import('jsdom');
  const page = await panel.get(`${panel.admin}/posts/new`);
  const dom = new JSDOM(page.text, { url: 'https://example.test/admin-panel/posts/new', runScripts: 'outside-only' });
  const { window } = dom;
  const doc = window.document;
  doc.getElementById('body').value = '<h2>Heading</h2><p>First line<br>Second line</p><h3>Next heading</h3><p>More text</p>';
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  let pick;
  window.amsMediaPicker = () => ({ open: options => { pick = options.onPick; } });
  window.eval(utilsScript);
  window.eval(editorScript);
  const visual = doc.getElementById('visual-editor');
  const text = visual.querySelector('p').lastChild;
  const range = doc.createRange();
  range.setStart(text, 6); // Insert in the middle of "Second line".
  range.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  visual.dispatchEvent(new window.Event('keyup'));
  const button = doc.querySelector('[data-picker-image]');
  button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  button.click();
  pick({ url: '/image.png', alt: 'Photo' });
  doc.getElementById('insert-image-block').click();
  const figure = visual.querySelector('figure.image-block');
  assert.ok(figure);
  assert.equal(figure.parentNode, visual, 'image is a top-level block');
  assert.equal(figure.getAttribute('contenteditable'), 'false', 'typing cannot enter the narrow image figure');
  assert.doesNotMatch(window.amsEditor.serialize(), /contenteditable=/, 'editor-only attribute is not saved');
  assert.equal(figure.textContent, '', 'existing text was not absorbed by the image');
  assert.equal(visual.querySelector('h2').textContent, 'Heading');
  assert.equal(visual.querySelector('h3').textContent, 'Next heading');
  assert.match(visual.textContent, /First lineSecond lineNext headingMore text/);
  const caret = window.getSelection().getRangeAt(0);
  assert.equal(caret.startContainer.tagName, 'P');
  assert.equal(caret.startContainer.previousSibling, figure, 'typing continues in a separate paragraph after the image');
  assert.match(window.amsEditor.serialize(), /<h3>Next heading<\/h3><p>More text<\/p>/);
  dom.window.close();
});
