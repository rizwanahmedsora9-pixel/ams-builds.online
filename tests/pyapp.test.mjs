/**
 * Python apps in the editor and on the public page.
 *
 * Four layers, each tested where it really runs:
 *   1. the markup helper (editor-utils) and the sanitizer agree on one shape;
 *   2. the editor dialog places an app as one selectable, resizable block;
 *   3. the server publishes it with its loader and serves the sandboxed runner;
 *   4. the Python bootstrap runs real programs in a real Pyodide: input(),
 *      functions, classes and callbacks that ask for input, errors, exit.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createHarness } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const panel = createHarness();
let utilsScript = '';
let editorScript = '';
let editorPage = '';
let security;
let pyapp;

async function load(entry) {
  const out = await build({ entryPoints: [join(ROOT, entry)], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
}

before(async () => {
  await panel.start();
  await panel.install();
  const page = await panel.get(`${panel.admin}/posts/new`);
  editorPage = page.text;
  const scripts = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  utilsScript = scripts.find((body) => body.includes('window.amsEditorUtils={')) || '';
  editorScript = scripts.find((body) => body.includes("document.getElementById('edit')") && body.includes('visual-editor')) || '';
  security = await load('src/lib/security.ts');
  pyapp = await load('src/lib/pyapp.ts');
});

after(async () => {
  await panel.stop();
  panel.cleanup();
});

function bootUtils() {
  const context = { console, URL, window: null };
  context.window = context;
  vm.createContext(context);
  new vm.Script(utilsScript).runInContext(context);
  return context.amsEditorUtils;
}

const SAMPLE = 'name = input("Your <name>: ")\nif name and len(name) > 1:\n    print(f"Hello, {name}!")\n';

/* ------------------------------------------------------------- 1. markup */

test('pythonFigure emits one inert block: escaped source, width in %, height in px', () => {
  const U = bootUtils();
  const fig = U.pythonFigure({ code: SAMPLE, name: 'C:\\apps\\greet me.py', width: 80, height: 500 });
  assert.match(fig, /^<figure class="python-app align-center" style="width:80%;height:500px" title="greet me\.py"><pre><code>/);
  assert.doesNotMatch(fig.replace(/^<figure[^>]*><pre><code>/, '').replace(/<\/code><\/pre><\/figure>$/, ''), /[<>"]/,
    'the program is text, never markup');
  assert.match(fig, /input\(&quot;Your &lt;name&gt;: &quot;\)/);
  assert.match(U.pythonFigure({ code: 'print(1)', manual: true, align: 'left' }), /class="python-app align-left python-app--manual"/);
  assert.match(U.pythonFigure({ code: 'print(1)', width: 5, height: 9999 }), /width:30%;height:1200px/, 'sizes are clamped');
  assert.match(U.pythonFigure({ code: 'print(1)' }), /width:100%;height:420px" title="app\.py"/, 'defaults: full width, 420px');
  assert.equal(U.pythonFigure({ code: '  \n ' }), '', 'an empty program is not a block');
  assert.equal(U.pythonName('../../etc/<x>.txt'), 'x.txt.py');
});

test('a writer is told before saving when a program cannot run in a browser', () => {
  const U = bootUtils();
  assert.equal(U.pythonWarnings(SAMPLE).length, 0);
  assert.match(U.pythonWarnings('import tkinter as tk\nroot = tk.Tk()')[0], /"tkinter" opens a desktop window/);
  assert.match(U.pythonWarnings('from flask import Flask')[0], /"flask" needs a server/);
  assert.match(U.pythonWarnings('  import threading')[0], /threads/);
  assert.equal(U.pythonWarnings('# import pygame is only mentioned here').length, 0, 'a comment is not an import');
});

test('the sanitizer keeps exactly the block the editor writes, for a non-admin author', () => {
  const U = bootUtils();
  const fig = U.pythonFigure({ code: SAMPLE, name: 'greet.py', width: 75, height: 360, manual: true, align: 'right' });
  assert.equal(security.sanitizeHtml(fig), fig, 'nothing in the block is dropped or rewritten');
  // Height is a pixel size of a block and nothing else.
  assert.equal(security.safeStyle('height:420px'), 'height:420px');
  assert.equal(security.safeStyle('height:100%'), '');
  assert.equal(security.safeStyle('height:expression(alert(1))'), '');
  assert.equal(security.safeStyle('height:99999px;position:fixed'), '');
  // The source is not prose: it stays out of automatic excerpts.
  assert.equal(security.stripTags(`<p>Intro.</p>${fig}<p>Outro.</p>`), 'Intro. Outro.');
});

/* ------------------------------------------------------------- 2. editor */

async function openEditor(body) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(editorPage, { url: 'https://example.test/admin-panel/posts/new', runScripts: 'outside-only' });
  const { window } = dom;
  const doc = window.document;
  doc.getElementById('body').value = body;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.Element.prototype.scrollIntoView = function () {};
  window.amsMediaPicker = () => ({ open() {} });
  window.eval(utilsScript);
  window.eval(editorScript);
  return { dom, window, doc, visual: doc.getElementById('visual-editor') };
}

test('the toolbar ships the Python button, grouped tools and pressed states', () => {
  assert.match(editorPage, /id="add-python"[^>]*>[\s\S]*?Python app/);
  assert.match(editorPage, /id="python-dialog"[\s\S]*id="python-file"[^>]*accept="\.py/);
  assert.match(editorPage, /class="tb-group"[^>]*aria-label="Text style"/);
  assert.match(editorPage, /data-command="bold"[^>]*aria-pressed="false"/, 'format buttons can show a pressed state');
  assert.match(editorPage, /data-exec="undo"/);
  assert.match(editorPage, /title="Add or edit a link \(Ctrl\+Shift\+K\)"/, 'the tooltip names the shortcut that really works');
  assert.match(editorPage, /@media \(max-width:820px\)\{[^}]*\.ams-editor \.toolbar[^{]*\{[^}]*flex-wrap:nowrap;overflow-x:auto/,
    'on a narrow screen the bar is one swipeable row');
  for (const handle of ['nw', 'ne', 'sw', 'se', 'w', 'e', 's']) assert.match(editorPage, new RegExp(`data-handle="${handle}"`));
  assert.match(editorPage, /\.image-tools\{position:absolute/, 'the block bar floats: selecting a block does not shift the page');
});

test('the dialog places a Python app as one top-level, selected block; edits and removes it', async () => {
  const { dom, window, doc, visual } = await openEditor('<h2>Heading</h2><p>Some text</p>');
  const text = visual.querySelector('p').firstChild;
  const range = doc.createRange();
  range.setStart(text, 4);
  range.collapse(true);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  visual.dispatchEvent(new window.Event('keyup'));

  doc.getElementById('add-python').click();
  assert.equal(doc.getElementById('python-dialog').open, true);
  doc.getElementById('insert-python').click();
  assert.equal(doc.getElementById('python-error').hidden, false, 'an empty program is refused, with a reason');
  assert.equal(doc.getElementById('python-dialog').open, true);

  doc.getElementById('python-code').value = SAMPLE;
  doc.getElementById('python-width').value = '80';
  doc.getElementById('python-height').value = '500';
  doc.getElementById('insert-python').click();
  assert.equal(doc.getElementById('python-dialog').open, false);

  const fig = visual.querySelector('figure.python-app');
  assert.ok(fig, 'the app is in the document');
  assert.equal(fig.parentNode, visual, 'as a top-level block, not inside the paragraph');
  assert.equal(fig.getAttribute('contenteditable'), 'false', 'the caret cannot wander into the code');
  assert.equal(fig.querySelector('pre').textContent, SAMPLE, 'the source survives byte for byte');
  assert.equal(fig.style.width, '80%');
  assert.equal(fig.style.height, '500px');
  assert.match(visual.textContent.replace(SAMPLE, ''), /HeadingSome text/, 'the text around it is intact');
  assert.ok(fig.classList.contains('is-selected'), 'it is selected straight away');
  assert.equal(doc.getElementById('python-tools').hidden, false, 'its bar is showing');
  assert.equal(doc.getElementById('image-tools').hidden, true);
  assert.equal(doc.getElementById('img-overlay').dataset.kind, 'python');

  // What is saved carries no editor-only state.
  const saved = window.amsEditor.serialize();
  assert.doesNotMatch(saved, /contenteditable|is-selected/);
  assert.match(saved, /<figure class="python-app align-center" style="width: ?80%; ?height: ?500px;?" title="app\.py"><pre><code>/);

  // The bar: size, height, alignment, start mode.
  const bar = doc.getElementById('python-tools');
  bar.querySelector('[data-img-size="50"]').click();
  assert.equal(fig.style.width, '50%');
  const height = doc.getElementById('py-height');
  height.value = '5000';
  height.dispatchEvent(new window.Event('change'));
  assert.equal(fig.style.height, '1200px', 'height is clamped');
  bar.querySelector('[data-img-align="left"]').click();
  assert.ok(fig.classList.contains('align-left') && !fig.classList.contains('align-center'));
  bar.querySelector('[data-py-autorun]').click();
  assert.ok(fig.classList.contains('python-app--manual'));
  assert.equal(bar.querySelector('[data-py-autorun]').getAttribute('aria-pressed'), 'false');

  // Move above the paragraph before it, then edit the code in place.
  const before = fig.previousElementSibling;
  bar.querySelector('[data-block-move="up"]').click();
  assert.equal(fig.nextElementSibling, before);
  bar.querySelector('[data-py-edit]').click();
  assert.equal(doc.getElementById('python-code').value, SAMPLE, 'the dialog opens with the current program');
  assert.equal(doc.getElementById('python-autorun').checked, false);
  doc.getElementById('python-code').value = 'print("v2")\n';
  doc.getElementById('insert-python').click();
  const edited = visual.querySelector('figure.python-app');
  assert.equal(visual.querySelectorAll('figure.python-app').length, 1, 'editing replaces, never duplicates');
  assert.equal(edited.querySelector('pre').textContent, 'print("v2")\n');
  assert.ok(edited.classList.contains('align-left'), 'placement is kept across an edit');

  // Delete removes the selected block and only it.
  visual.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  assert.equal(visual.querySelector('figure.python-app'), null);
  assert.equal(doc.getElementById('python-tools').hidden, true);
  assert.match(visual.textContent, /HeadingSome text/);
  dom.window.close();
});

test('the dialog offers the shipped samples, and one fills the code box ready to insert', async () => {
  const { dom, window, doc, visual } = await openEditor('');
  doc.getElementById('add-python').click();
  const select = doc.getElementById('python-sample');
  const options = [...select.options].map((option) => option.value).filter(Boolean);
  assert.deepEqual(options, readdirSync(join(ROOT, 'samples', 'python')).filter((f) => f.endsWith('.py')).sort().map((f) => f.replace(/^\d+-/, '')),
    'every sample in the folder is offered, under its plain name');
  select.value = 'hello.py';
  select.dispatchEvent(new window.Event('change'));
  const code = doc.getElementById('python-code').value;
  assert.match(code, /print\("Hello from Python"/, 'the program lands in the code box');
  assert.match(doc.getElementById('python-file-name').textContent, /^hello\.py · \d+ lines$/);
  assert.equal(select.value, '', 'the list goes back to its prompt, so it can be used again');
  doc.getElementById('insert-python').click();
  const fig = visual.querySelector('figure.python-app');
  assert.ok(fig, 'and inserts as one block');
  assert.equal(fig.getAttribute('title'), 'hello.py');
  assert.equal(fig.querySelector('pre').textContent, code);
  dom.window.close();
});

test('src/admin/py-samples.ts is the samples folder, baked', () => {
  const dir = join(ROOT, 'samples', 'python');
  const expected = readdirSync(dir).filter((f) => f.endsWith('.py')).sort().map((file) => ({
    name: file.replace(/^\d+-/, ''),
    code: readFileSync(join(dir, file), 'utf8').replace(/\r\n?/g, '\n'),
  }));
  const baked = readFileSync(join(ROOT, 'src', 'admin', 'py-samples.ts'), 'utf8');
  const rows = [...baked.matchAll(/"name": "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(rows, expected.map((row) => row.name), 'same files, same order');
  for (const row of expected) assert.ok(baked.includes(JSON.stringify(row.code)), `${row.name} is identical`);
});

test('a saved app reopens as a block, and the HTML tab round-trips it unchanged', async () => {
  const U = bootUtils();
  const fig = U.pythonFigure({ code: SAMPLE, name: 'greet.py', width: 60, height: 300 });
  const { dom, window, visual } = await openEditor(`<p>Before</p>${fig}<p>After</p>`);
  assert.equal(window.amsEditor.mode(), 'text');
  assert.equal(visual.querySelector('figure.python-app').getAttribute('contenteditable'), 'false');
  // Through the sanitizer (a non-admin's save) and back: same program, same area.
  const holder = window.document.createElement('div');
  holder.innerHTML = security.sanitizeHtml(window.amsEditor.serialize());
  const back = holder.querySelector('figure.python-app');
  assert.equal(back.querySelector('pre').textContent, SAMPLE);
  assert.equal(back.getAttribute('style').replace(/[ ;]+$/g, '').replace(/\s/g, ''), 'width:60%;height:300px');
  assert.equal(back.getAttribute('title'), 'greet.py');
  assert.equal(back.hasAttribute('contenteditable'), false);
  assert.equal(holder.firstChild.outerHTML + holder.lastChild.outerHTML, '<p>Before</p><p>After</p>');
  dom.window.close();
});

/* ------------------------------------------------------------- 3. server */

test('a published app is served with its loader; other pages pay nothing', async () => {
  const U = bootUtils();
  const fig = U.pythonFigure({ code: SAMPLE, name: 'greet.py', width: 80, height: 360 });
  const created = await panel.adminPost('/pages/save', { title: 'Python Demo', slug: 'python-demo', body: `<p>Try it:</p>${fig}`, status: 'published' });
  assert.ok(created.status === 302 || created.status === 303, 'saved');
  const page = await panel.anon('/python-demo');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(fig), 'the block is in the page as written (readable with scripts off)');
  const script = page.text.match(/<script nonce="([^"]+)">\(function\(\)\{\s*var figs=document\.querySelectorAll\('figure\.python-app'\)/);
  assert.ok(script, 'the loader is inline and carries the response nonce');
  assert.match(page.text, new RegExp(`<style nonce="${script[1]}">figure\\.python-app\\{`), 'with the block stylesheet');
  assert.match(page.text, /frame\.setAttribute\('sandbox','allow-scripts allow-downloads'\)/, 'the app is framed without same-origin access');
  const csp = page.headers.get('content-security-policy') || page.headers.get('content-security-policy-report-only') || '';
  assert.match(csp, new RegExp(`script-src 'self' 'nonce-${script[1]}'`));
  assert.match(csp, /frame-src 'self'/);
  assert.match(csp, /style-src-attr 'unsafe-inline'/, 'saved widths survive an enforced policy');

  // The loader, run on the page as served: the listing becomes a sandboxed frame
  // of the runner, which is handed the program when it says it is ready.
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(page.text, { url: 'https://example.test/python-demo', runScripts: 'outside-only' });
  dom.window.eval(script.input.slice(script.index).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
  const live = dom.window.document.querySelector('figure.python-app');
  const frame = live.querySelector('iframe');
  assert.ok(frame, 'the app starts without a click');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-downloads');
  assert.equal(frame.getAttribute('src'), pyapp.PYAPP_RUNNER_PATH);
  assert.equal(live.querySelector('pre').hidden, true);
  assert.equal(live.style.width, '80%');
  assert.equal(live.style.height, '360px');
  const sent = [];
  frame.contentWindow.postMessage = (message) => sent.push(message);
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { ams: 'pyapp', t: 'ready' }, source: dom.window }));
  assert.equal(sent.length, 0, 'only its own frame is answered');
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { ams: 'pyapp', t: 'ready' }, source: frame.contentWindow }));
  assert.equal(JSON.stringify(sent), JSON.stringify([{ ams: 'pyapp', t: 'code', code: SAMPLE, name: 'greet.py' }]));
  dom.window.close();
  // "Start on click" shows a Run button first and loads nothing until pressed.
  const manual = new JSDOM(`<body>${U.pythonFigure({ code: SAMPLE, manual: true })}</body>`, { runScripts: 'outside-only' });
  manual.window.eval(pyapp.PYAPP_PUBLIC_JS);
  assert.equal(manual.window.document.querySelector('iframe'), null);
  manual.window.document.querySelector('.python-app__poster button').click();
  assert.ok(manual.window.document.querySelector('figure.python-app iframe'));
  assert.equal(manual.window.document.querySelector('.python-app__poster'), null);
  manual.window.close();

  const plain = await panel.adminPost('/pages/save', { title: 'Plain Page', slug: 'plain-page', body: '<p>No apps. The words python-app in text do not count.</p>', status: 'published' });
  assert.ok(plain.status === 302 || plain.status === 303, 'saved');
  assert.doesNotMatch((await panel.anon('/plain-page')).text, /figure\.python-app/);
});

test('the runner is a static, sandboxed document with its own policy', async () => {
  const res = await panel.anon(pyapp.PYAPP_RUNNER_PATH);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /(^|; )sandbox allow-scripts allow-downloads($|;)/, 'opaque origin even when opened directly');
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /connect-src https:\/\/cdn\.jsdelivr\.net https:\/\/pypi\.org https:\/\/files\.pythonhosted\.org/);
  assert.doesNotMatch(csp, /connect-src https:(?:\s|;)/, 'there is no unrestricted HTTPS egress');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.ok(res.text.includes(pyapp.PYODIDE_BASE.replace(/\//g, '\\/')) || res.text.includes(pyapp.PYODIDE_BASE));
  assert.match(res.text, /if\(e\.source!==window\.parent\)return/, 'it takes its program only from the page that frames it');
  assert.equal(require('pyodide/package.json').version, pyapp.PYODIDE_VERSION, 'the tested interpreter is the published one');
  // The inline script is valid JavaScript (a bad escape would kill every app).
  const inline = res.text.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(inline));
  // The worker must be classic: a module worker from a blob: URL never starts in
  // an opaque-origin frame (sandboxed without allow-same-origin) in Chrome.
  assert.match(res.text, /new Worker\(url\)/, 'a classic worker, not { type: "module" }');
  assert.doesNotMatch(res.text, /\{type:'module'\}/, 'no module worker');
  assert.match(res.text, /importScripts\(base\+'pyodide\.js'\)/);
  assert.match(res.text, /self\.fetch=blocked/);
  assert.match(res.text, /self\.importScripts=function/);
  assert.match(res.text, /self\.Worker=function/);
  // The worker is itself a JSON string inside the page: check the cooked script,
  // not the doubly escaped source, so template-literal mistakes cannot ship.
  const worker = JSON.parse(res.text.match(/WORKER=("(?:[^"\\]|\\.)*");/)[1]);
  assert.doesNotThrow(() => new Function('self', 'postMessage', 'importScripts', worker));
  const qrCheck = worker.match(/if\((\/.*\/)\.test\(m\.code\)\)/)[1];
  const isQrSample = new Function('code', `return ${qrCheck}.test(code);`);
  const qrSample = readFileSync(join(ROOT, 'samples', 'python', '10-qr-code-maker.py'), 'utf8');
  assert.equal(isQrSample(qrSample), true, 'the shipped QR sample triggers pre-install');
  assert.equal(isQrSample(qrSample.replace('"qrcode==8.2"', "'qrcode==8.2'")), true, 'single quotes work too');
  assert.equal(isQrSample(qrSample.replace('micropip.install(', 'micropip.install (')), true, 'whitespace works too');
  assert.equal(isQrSample('await micropip.install("qrcode==8.1")'), false, 'only the pinned version is pre-installed');
  assert.ok(worker.indexOf("await py.loadPackage('micropip')") < worker.indexOf('self.fetch=blocked'),
    'micropip is loaded before networking is disabled');
  assert.ok(worker.indexOf('self.fetch=blocked') < worker.indexOf('py.runPython(boot)'),
    'networking is disabled before the Python bootstrap and author code run');
});

/* ------------------------------------------------------- 4. real Python */

/**
 * What importScripts(base + 'pyodide.js') does in a browser: leaves a
 * loadPyodide() on the worker's global scope, with no module syntax involved.
 *
 * The npm copy of pyodide.js is a CommonJS module and, in Node, takes an
 * `import()` path that cannot run inside a function built with new Function(). In
 * a browser that branch is never taken (there is no `process`), so the script is
 * a plain classic script. Here the same interpreter API is imported from
 * pyodide.mjs and handed to the worker the same way: as a global function.
 */
function pyodideScriptLoader(local, target = globalThis) {
  const dir = fileURLToPath(local);
  let ready = null;
  return async (url) => {
    if (!ready) {
      const file = url.startsWith(local) ? join(dir, url.slice(local.length)) : fileURLToPath(url);
      const esm = join(dirname(file), 'pyodide.mjs');
      ready = import(pathToFileURL(esm).href).then((mod) => { target.loadPyodide = mod.loadPyodide; });
    }
    await ready;
  };
}

/** Drives the shipped worker script against the real interpreter. */
function runProgram(code, answers = [], files = []) {
  const page = pyapp.pythonRunnerPage();
  const [, base, boot, worker] = page.match(/var BASE=("(?:[^"\\]|\\.)*"),BOOT=("(?:[^"\\]|\\.)*"),WORKER=("(?:[^"\\]|\\.)*");/).map((part, i) => (i ? JSON.parse(part) : part));
  assert.match(base, /^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v[\d.]+\/full\/$/);
  const local = pathToFileURL(dirname(require.resolve('pyodide/package.json'))).href + '/';
  return new Promise((resolve, reject) => {
    // Like a worker's global scope: the script it loads defines loadPyodide there.
    const self = Object.create(globalThis);
    const queue = [...answers];
    const pendingFiles = [...files];
    let out = '';
    const events = [];
    let produced = null;
    const timer = setTimeout(() => reject(new Error('the program did not finish:\n' + out)), 60000);
    const postMessage = (m) => {
      events.push(m.t);
      if (m.t === 'out') out += m.s;
      else if (m.t === 'err') out += `[err]${m.s}`;
      else if (m.t === 'file') produced = m.s;
      else if (m.t === 'pick') {
        const next = pendingFiles.length ? pendingFiles.shift() : null;
        setTimeout(() => self.onmessage({ data: { t: 'files', files: next } }), 0);
      }
      else if (m.t === 'ask') {
        if (!queue.length) { clearTimeout(timer); resolve({ out, events, status: 'waiting' }); return; }
        const line = queue.shift();
        out += line + '\n';
        setTimeout(() => self.onmessage({ data: { t: 'line', s: line } }), 0);
      } else if (m.t === 'end' || m.t === 'fail') { clearTimeout(timer); resolve({ out, events, status: m.t === 'fail' ? `fail:${m.s}` : m.s, produced }); }
    };
    // A classic worker: one global function, importScripts, no modules. The
    // local files stand in for the CDN so the real code path is exercised.
    const importScripts = pyodideScriptLoader(local);
    new Function('self', 'postMessage', 'importScripts', worker)(self, postMessage, importScripts);
    self.onmessage({ data: { t: 'config', base: local, index: fileURLToPath(local), boot } });
    self.onmessage({ data: { t: 'run', code, name: 'app.py' } });
  });
}

test('python: print and input() work as written, at the top level', async () => {
  const r = await runProgram('name = input("Name: ")\nprint("Hi", name)\n', ['Ali']);
  assert.equal(r.status, 'done');
  assert.equal(r.out, 'Name: Ali\nHi Ali\n');
  assert.deepEqual(r.events.filter((e) => e === 'start' || e === 'ask' || e === 'end'), ['start', 'ask', 'end']);
});

test('python: a menu app - functions that ask for input, nested calls, a __main__ guard', async () => {
  const r = await runProgram(`
def ask(prompt):
    return int(input(prompt))

def add():
    a = ask("a: ")
    b = ask("b: ")
    print("sum", a + b)

def main():
    while True:
        choice = input("> ")
        if choice == "q":
            break
        add()

if __name__ == "__main__":
    main()
`, ['go', '2', '3', 'q']);
  assert.equal(r.status, 'done');
  assert.equal(r.out, '> go\na: 2\nb: 3\nsum 5\n> q\n');
});

test('python: classes that ask in __init__, inheritance, dispatch tables, callbacks and comprehensions', async () => {
  const r = await runProgram(`
import time

class Account:
    def __init__(self):
        self.owner = input("Owner: ")
        self.balance = 0
    def deposit(self):
        self.balance += float(input("Amount: "))
    def __str__(self):
        return f"{self.owner}: {self.balance}"

class Savings(Account):
    def __init__(self, rate):
        super().__init__()
        self.rate = rate

class Plain:
    def __init__(self, value):
        self.value = value

def apply(fn):
    fn("callback ran")

def menu():
    acct = Savings(0.1)
    actions = {"d": acct.deposit, "p": lambda: print(acct)}
    while True:
        key = input("? ")
        if key == "x":
            return acct
        actions[key]()

acct = menu()
nums = [int(input()) for _ in range(2)]
apply(print)
time.sleep(0.01)
print(Plain(3).value, sorted([3, 1, 2], key=lambda n: -n), sum(nums), acct.rate)
`, ['Zed', 'd', '5', 'p', 'x', '4', '6']);
  assert.equal(r.status, 'done', r.out);
  assert.equal(r.out, 'Owner: Zed\n? d\nAmount: 5\n? p\nZed: 5.0\n? x\n4\n6\ncallback ran\n3 [3, 2, 1] 10 0.1\n');
});

test('python: errors show the writer\'s own lines, exit codes and syntax errors are reported', async () => {
  const crash = await runProgram('def f():\n    return 1 / 0\nprint("before")\nf()\n');
  assert.equal(crash.status, 'error');
  assert.match(crash.out, /^before\n\[err\]Traceback \(most recent call last\):\n  File "app\.py", line 4, in <module>/);
  assert.match(crash.out, /File "app\.py", line 2, in f\n    return 1 \/ 0/);
  assert.match(crash.out, /ZeroDivisionError: division by zero\n$/);
  assert.doesNotMatch(crash.out, /<exec>|ams_run/, 'the runner\'s own frames are not shown');

  const bye = await runProgram('import sys\nprint("bye")\nsys.exit(0)\nprint("never")\n');
  assert.equal(bye.status, 'done');
  assert.equal(bye.out, 'bye\n');

  const bad = await runProgram('def (:\n');
  assert.equal(bad.status, 'error');
  assert.match(bad.out, /SyntaxError/);

  const hidden = await runProgram('class A:\n    def __str__(self):\n        return input("x")\nprint(A())\n');
  assert.equal(hidden.status, 'error');
  assert.match(hidden.out, /input\(\) was called from a place that cannot wait/, 'an impossible input() says why instead of hanging');
});

test('the runner page: output lands in the terminal, the answer box feeds input(), Restart runs again', async () => {
  const { JSDOM } = await import('jsdom');
  const page = pyapp.pythonRunnerPage();
  const workerSource = JSON.parse(page.match(/,WORKER=("(?:[^"\\]|\\.)*");/)[1]);
  const local = pathToFileURL(dirname(require.resolve('pyodide/package.json'))).href + '/';
  let workers = 0;
  const dom = new JSDOM(page, {
    url: 'https://example.test/__pyapp/runner', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.URL.createObjectURL = () => 'blob:worker';
      window.URL.revokeObjectURL = () => {};
      // A classic Worker that runs the shipped worker script in this process.
      window.Worker = class {
        constructor() {
          workers++;
          this.dead = false;
          this.inner = Object.create(window);
          const importScripts = pyodideScriptLoader(local, this.inner);
          new Function('self', 'postMessage', 'importScripts', workerSource)(this.inner, (m) => { if (!this.dead && this.onmessage) this.onmessage({ data: m }); }, importScripts);
        }
        // The CDN stands in for the local copy; index must be a file path here.
        postMessage(m) { this.inner.onmessage({ data: { ...m, base: local, index: fileURLToPath(local) } }); }
        terminate() { this.dead = true; }
      };
    },
  });
  const { window } = dom;
  const doc = window.document;
  const until = async (check, what) => {
    for (let i = 0; i < 600; i++) { if (check()) return; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error(`timed out waiting for ${what}: ${doc.getElementById('out').textContent}`);
  };
  const out = () => doc.getElementById('out').textContent;
  // The embedding page answers "ready" with the program.
  const send = (data) => window.dispatchEvent(new window.MessageEvent('message', { data, source: window.parent }));
  send({ ams: 'pyapp', t: 'code', code: 'n = input("Number: ")\nprint("Double:", int(n) * 2)\n', name: 'double.py' });
  assert.equal(doc.getElementById('name').textContent, 'double.py');
  await until(() => doc.getElementById('in'), 'the answer box');
  assert.equal(out(), 'Number: ');
  assert.equal(doc.getElementById('status').textContent, 'Waiting for your input');
  const field = doc.getElementById('in');
  field.value = '21';
  field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await until(() => /program finished/.test(out()), 'the program to finish');
  assert.match(out(), /^Number: 21\nDouble: 42\n/);
  assert.equal(doc.getElementById('in'), null, 'the answer box is gone once the program ends');
  assert.equal(doc.getElementById('status').textContent, 'Finished');
  // A message from anywhere but the embedding page is ignored.
  window.dispatchEvent(new window.MessageEvent('message', { data: { ams: 'pyapp', t: 'code', code: 'print("evil")' }, source: null }));
  assert.equal(workers, 1);
  doc.getElementById('restart').click();
  assert.equal(workers, 2, 'Restart starts a fresh interpreter');
  await until(() => doc.getElementById('in'), 'the answer box again');
  assert.equal(out(), 'Number: ', 'the screen was cleared');
  window.close();
});

/* ------------------------------------------- 5. files in, files out */

test('python: an image goes in and a PDF comes out, through the real bridge', async () => {
  const photo = { name: 'cat.jpg', mime: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 7]).toString('base64') };
  const r = await runProgram(`
photo = ams_pick_file("image/*")
raw = open(photo, "rb").read()
print("picked", photo.split("/")[-1], len(raw))
# One page, embedding the JPEG as it is (DCTDecode): a valid PDF with no package.
pdf = (b"%PDF-1.4\\n"
       b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n"
       b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\\n"
       b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]/Contents 4 0 R>>endobj\\n"
       b"4 0 obj<</Length 0>>stream\\nendstream endobj\\n"
       b"5 0 obj<</Type/XObject/Subtype/Image/Width 1/Height 1/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length "
       + str(len(raw)).encode() + b">>stream\\n" + raw + b"\\nendstream endobj\\n"
       b"trailer<</Root 1 0 R/Size 6>>\\n%%EOF\\n")
open("photo.pdf", "wb").write(pdf)
ams_download("photo.pdf")
`, [], [[photo]]);
  assert.equal(r.status, 'done', r.out);
  assert.equal(r.out, 'picked cat.jpg 8\n');
  assert.ok(r.produced, 'the program handed a file to the page');
  assert.equal(r.produced.name, 'photo.pdf');
  assert.equal(r.produced.mime, 'application/pdf');
  const bytes = Buffer.from(r.produced.data, 'base64');
  assert.ok(bytes.toString('latin1').startsWith('%PDF-1.4'));
  assert.ok(bytes.includes(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 7])), 'the image travels inside the PDF');
});

test('python: several files, a cancel, a path that cannot escape, and a clear missing-file error', async () => {
  const jpg = { name: '../../etc/passwd.jpg', mime: 'image/jpeg', data: Buffer.from('one').toString('base64') };
  const many = await runProgram(`
paths = ams_pick_file("image/*", multiple=True)
print(len(paths), [p.split("/")[-1] for p in paths])
print(all(p.startswith("/home/pyodide/uploads/") for p in paths))
`, [], [[jpg, { ...jpg, name: 'two.png', mime: 'image/png' }]]);
  assert.equal(many.status, 'done', many.out);
  assert.equal(many.out, "2 ['passwd.jpg', 'two.png']\nTrue\n", 'a name from the page cannot pick the directory');

  const cancelled = await runProgram('p = ams_pick_file()\nprint("cancelled" if p is None else "got one")\n', [], [null]);
  assert.equal(cancelled.out, 'cancelled\n');

  const missing = await runProgram('ams_download("/nope.pdf")\n');
  assert.equal(missing.status, 'error');
  assert.match(missing.out, /FileNotFoundError: ams_download could not read \/nope\.pdf/);
});

test('the runner: the picker feeds the program, the result becomes a download, Cancel is an answer', async () => {
  const { JSDOM } = await import('jsdom');
  const page = pyapp.pythonRunnerPage();
  const workerSource = JSON.parse(page.match(/,WORKER=("(?:[^"\\]|\\.)*");/)[1]);
  const local = pathToFileURL(dirname(require.resolve('pyodide/package.json'))).href + '/';
  const dom = new JSDOM(page, {
    url: 'https://example.test/__pyapp/runner', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.URL.createObjectURL = () => 'blob:made-file';
      window.URL.revokeObjectURL = () => {};
      window.Worker = class {
        constructor() {
          this.dead = false;
          this.inner = Object.create(window);
          const importScripts = pyodideScriptLoader(local, this.inner);
          new Function('self', 'postMessage', 'importScripts', workerSource)(this.inner, (m) => { if (!this.dead && this.onmessage) this.onmessage({ data: m }); }, importScripts);
        }
        // The CDN stands in for the local copy; index must be a file path here.
        postMessage(m) { this.inner.onmessage({ data: { ...m, base: local, index: fileURLToPath(local) } }); }
        terminate() { this.dead = true; }
      };
    },
  });
  const { window } = dom;
  const doc = window.document;
  const until = async (check, what) => {
    for (let i = 0; i < 900; i++) { if (check()) return; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error(`timed out waiting for ${what}: ${doc.getElementById('out').textContent}`);
  };
  const send = (data) => window.dispatchEvent(new window.MessageEvent('message', { data, source: window.parent }));
  const program = `
photo = ams_pick_file("image/*")
if photo is None:
    print("cancelled")
else:
    print("got", photo.split("/")[-1])
    open("out.pdf", "wb").write(b"%PDF-1.4\\n")
    ams_download("out.pdf")
`;
  send({ ams: 'pyapp', t: 'code', code: program, name: 'img2pdf.py' });
  await until(() => doc.querySelector('.pick'), 'the file picker');
  const row = doc.querySelector('.pick');
  assert.equal(doc.getElementById('status').textContent, 'Waiting for you to choose a file');
  assert.match(row.textContent, /The program needs a file \(image\/\*\)/);
  const input = row.querySelector('input[type=file]');
  assert.equal(input.accept, 'image/*');
  const file = new window.File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9])], 'cat.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change'));

  await until(() => doc.querySelector('#out .dl'), 'the download link');
  const link = doc.querySelector('#out .dl');
  assert.equal(link.getAttribute('download'), 'out.pdf');
  assert.equal(link.getAttribute('href'), 'blob:made-file', 'the file is a blob, not a URL to somewhere');
  assert.match(link.textContent, /Download out\.pdf · \d+ B/);
  assert.equal(row.isConnected, false, 'the picker is gone once a file was chosen');
  await until(() => /program finished/.test(doc.getElementById('out').textContent), 'the program to finish');
  assert.match(doc.getElementById('out').textContent, /→ cat\.jpg\ngot cat\.jpg/);

  // Cancel answers the same question with nothing.
  doc.getElementById('restart').click();
  await until(() => doc.querySelector('.pick'), 'the picker again');
  doc.querySelector('.pick').querySelectorAll('button')[1].click();
  await until(() => /program finished/.test(doc.getElementById('out').textContent), 'the cancelled program to finish');
  assert.match(doc.getElementById('out').textContent, /→ no file chosen\s+cancelled/);
  window.close();
});

/* ------------------------------------------------------- 6. the samples */

test('every sample app in samples/python really runs', async () => {
  const dir = join(ROOT, 'samples', 'python');
  const files = readdirSync(dir).filter((name) => name.endsWith('.py')).sort();
  assert.ok(files.length >= 8, 'the samples are there');
  const csv = 'name,total\nA,3\nB,5\nC,7\n';
  // A real, tiny PNG: Pillow correctly rejects the old placeholder bytes.
  const png = { name: 'one.png', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYEiRY2DARCwMGgxYAT0kAOneAhSDT89FAAAAAElFTkSuQmCC' };

  for (const file of files) {
    const code = readFileSync(join(dir, file), 'utf8');
    // Enough answers for every question each sample asks, and a file for the
    // two that take one.
    const answers = ['Zed', '12 * 3', 'q', 'first line', '', '42', 'Islamabad', 'Python', 'note'];
    const filesFor = file.includes('image-to-pdf') || file.includes('image-compressor') ? [[png]] : file.includes('csv-report') ? [[{ name: 'data.csv', mime: 'text/csv', data: Buffer.from(csv).toString('base64') }]] : [];
    const r = await runProgram(code, answers, filesFor);
    // matplotlib, Pillow and pandas wheels, and the QR sample's small pure-Python
    // PyPI dependency, may be unavailable in an offline test environment.
    // Startup failures arrive in status rather than stdout, so inspect both.
    const diagnostic = r.out + (r.status.startsWith('fail:') ? r.status.slice(5) : '');
    const offline = /No module named '(matplotlib|PIL|pandas|qrcode|micropip)'|Failed to load|NetworkError|fetch failed|Unable to fetch/i.test(diagnostic);
    if (offline) {
      assert.match(file, /0[4-7]-|09-image-compressor|10-qr-code-maker/, `${file} needs a browser package: ${r.out}`);
      continue;
    }
    assert.equal(r.status, 'done', `${file}: ${r.out}`);
    assert.doesNotMatch(r.out, /Traceback/, `${file} ran cleanly: ${r.out}`);
    assert.ok(r.out.trim().length > 0, `${file} printed something`);
    if (file.includes('notes-to-pdf') || file.includes('csv-report') || file.includes('image-to-pdf') || file.includes('image-compressor') || file.includes('qr-code-maker')) {
      assert.ok(r.produced, `${file} handed a file back`);
    }
    if (file.includes('image-compressor')) {
      const bytes = Buffer.from(r.produced.data, 'base64');
      assert.equal(r.produced.mime, 'image/jpeg');
      assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8], 'the output is a real JPEG');
    }
    if (file.includes('qr-code-maker')) {
      const svg = Buffer.from(r.produced.data, 'base64').toString('utf8');
      assert.equal(r.produced.mime, 'image/svg+xml');
      assert.match(svg, /<svg[\s>]/, 'the output is a real SVG QR code');
    }
    if (file.includes('matplotlib')) assert.ok(r.events.length > 0);
  }
});
