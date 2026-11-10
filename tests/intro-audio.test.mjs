import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const component = readFileSync(new URL('../src/components/IntroOverlay.astro', import.meta.url), 'utf8');
const script = component.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const markup = component.split('<script>')[0];

function setup() {
  class Element {
    constructor(tag = 'div') {
      this.tag = tag;
      this.listeners = {};
      this.classes = new Set();
      this.attrs = {};
      this.classList = {
        add: (...names) => names.forEach((name) => this.classes.add(name)),
        remove: (...names) => names.forEach((name) => this.classes.delete(name)),
        contains: (name) => this.classes.has(name),
      };
      this.style = { setProperty() {} };
      this.textContent = '';
      this.children = [];
    }
    addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
    dispatch(name, event = {}) { for (const fn of this.listeners[name] ?? []) fn(event); }
    setAttribute(k, v) { this.attrs[k] = v; }
    removeAttribute(k) { delete this.attrs[k]; }
    remove() { this.removed = true; }
    querySelector(sel) { return this.queries?.find((q) => q.sel === sel)?.el ?? new Element(); }
    querySelectorAll() { return []; }
  }
  const ids = ['ams-intro-overlay', 'ams-enter-btn', 'ams-carousel-track', 'ams-carousel-dots',
    'ams-start-demo', 'ams-status', 'ams-now-playing', 'ams-audio-player', 'ams-demo-gate',
    'ams-stage-controls', 'ams-expand-btn', 'ams-expand-label', 'ams-collapse-btn',
    'ams-prev-btn', 'ams-next-btn', 'ams-sound-toggle', 'ams-stage'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));

  const track = elements['ams-carousel-track'];
  track.children = [new Element('article'), new Element('article')];

  const audio = elements['ams-audio-player'];
  const requests = [];
  Object.defineProperty(audio, 'src', {
    get() { return this._src; },
    set(value) { this._src = value; this.error = null; },
  });
  audio.play = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
  audio.pause = () => {};
  audio.load = () => {};
  audio.currentTime = 0;
  audio.volume = 0;
  audio.muted = false;
  audio.paused = false;

  const document = new Element();
  document.body = { style: {}, classList: { add() {}, remove() {} } };
  document.getElementById = (id) => elements[id] ?? null;

  vm.runInNewContext(script, {
    document,
    sessionStorage: { getItem: () => null, setItem() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    console,
  });
  return { elements, audio, requests, document, track };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('the catalogue is hidden behind a centred gate until the demo is started', () => {
  const { elements, requests } = setup();
  // autoplay is attempted but the gate is still closed
  requests[0].resolve();
  assert.equal(elements['ams-demo-gate'].attrs['data-open'], undefined);
  assert.equal(elements['ams-stage-controls'].attrs['data-live'], undefined);
  // the demo button is not hidden any more (it lives inside the gate)
  assert.equal(elements['ams-start-demo'].classList.contains('hidden'), false);
});

test('pressing the demo button opens the stage and the catalogue starts running', () => {
  const { elements, track, requests } = setup();
  assert.equal(track.style.transform, 'translateX(-0%)');
  elements['ams-start-demo'].dispatch('click');
  assert.equal(elements['ams-demo-gate'].attrs['data-open'], 'true');
  assert.equal(elements['ams-stage-controls'].attrs['data-live'], 'true');
  assert.equal(elements['ams-intro-overlay'].attrs['data-state'], 'playing');
  // advances immediately so the demo clearly "runs"
  assert.equal(track.style.transform, 'translateX(-100%)');
  assert.equal(requests.length >= 2, true);
});

test('music starts from the demo click, and the demo still runs if a track fails', () => {
  const { elements, audio, requests } = setup();
  elements['ams-start-demo'].dispatch('click');
  assert.equal(audio.muted, false);
  assert.equal(audio.volume, 1);
  // both tracks fail → no dead end, catalogue still plays
  audio.error = {};
  audio.dispatch('error');
  audio.error = {};
  audio.dispatch('error');
  assert.match(elements['ams-status'].textContent, /unavailable/);
  assert.equal(elements['ams-stage-controls'].attrs['data-live'], 'true');
});

test('while playing only the equalizer is shown: no track name is rendered anywhere', () => {
  const { elements, audio, requests } = setup();
  requests[0].resolve();
  audio.dispatch('playing');
  for (const el of Object.values(elements)) {
    assert.doesNotMatch(String(el.textContent), /BAILA|Tulin|sma\$her|phonk/i);
  }
  assert.equal(elements['ams-now-playing'].classList.contains('flex'), true);
});

test('expand button blows the catalogue up to the full page and back', () => {
  const { elements } = setup();
  elements['ams-start-demo'].dispatch('click');
  const expand = elements['ams-expand-btn'];
  expand.dispatch('click');
  assert.equal(elements['ams-intro-overlay'].attrs['data-expanded'], 'true');
  assert.equal(elements['ams-expand-label'].textContent, 'Shrink');
  assert.equal(expand.attrs['aria-pressed'], 'true');
  expand.dispatch('click');
  assert.equal(elements['ams-intro-overlay'].attrs['data-expanded'], 'false');
  assert.equal(elements['ams-expand-label'].textContent, 'Expand');
});

test('Escape leaves full-page mode first, then dismisses the intro', () => {
  const { document, elements } = setup();
  elements['ams-start-demo'].dispatch('click');
  elements['ams-expand-btn'].dispatch('click');
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal(elements['ams-intro-overlay'].attrs['data-expanded'], 'false');
  assert.equal(elements['ams-intro-overlay'].attrs['data-state'], 'playing');
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal(elements['ams-intro-overlay'].attrs['data-state'], 'exiting');
});

test('keyboard activation does not dismiss the intro; Escape does', () => {
  const { document, elements } = setup();
  document.dispatch('keydown', { key: 'Enter' });
  assert.equal(elements['ams-intro-overlay'].attrs['data-state'], undefined);
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal(elements['ams-intro-overlay'].attrs['data-state'], 'exiting');
});

test('the overlay markup locks the viewport and centres one demo button', () => {
  assert.match(markup, /id="ams-intro-overlay"/);
  assert.match(markup, /h-\[100dvh\]/);
  assert.match(markup, /id="ams-demo-gate"[^>]*absolute inset-0 grid place-items-center/);
  assert.equal((markup.match(/id="ams-start-demo"/g) || []).length, 1);
  assert.match(markup, /id="ams-expand-btn"/);
  // swipes are driven by the measured BPM of each track
  assert.match(script, /bpm: 84/);
  assert.match(script, /bpm: 75/);
  assert.match(script, /BEATS_PER_SLIDE = 8/);
});
