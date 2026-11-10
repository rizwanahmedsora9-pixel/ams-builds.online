import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const component = readFileSync(new URL('../src/components/IntroOverlay.astro', import.meta.url), 'utf8');
const script = component.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

function setup() {
  class Element {
    constructor() {
      this.listeners = {};
      this.classes = new Set();
      this.classList = {
        add: (...names) => names.forEach((name) => this.classes.add(name)),
        remove: (...names) => names.forEach((name) => this.classes.delete(name)),
        contains: (name) => this.classes.has(name),
      };
      this.style = {};
      this.children = [];
    }
    addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
    dispatch(name, event = {}) { for (const fn of this.listeners[name] ?? []) fn(event); }
    setAttribute() {}
    removeAttribute() {}
    remove() {}
    querySelectorAll() { return []; }
  }
  const ids = ['ams-intro-overlay', 'ams-enter-btn', 'ams-carousel-track', 'ams-sound-hint',
    'ams-unmute-btn', 'ams-sound-label', 'ams-now-playing', 'ams-now-playing-title', 'ams-audio-player'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements['ams-carousel-track'].nextElementSibling = new Element();
  const audio = elements['ams-audio-player'];
  const requests = [];
  Object.defineProperty(audio, 'src', {
    get() { return this._src; },
    set(value) { this._src = value; this.error = null; },
  });
  audio.play = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
  audio.pause = () => {};
  audio.load = () => {};
  const document = new Element();
  document.body = { style: {} };
  document.getElementById = (id) => elements[id];
  vm.runInNewContext(script, {
    document, sessionStorage: { getItem: () => null, setItem() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout() {}, console,
  });
  return { elements, audio, requests, document };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('blocked autoplay can be started by clicking and stale rejection cannot mute it', async () => {
  const { elements, audio, requests } = setup();
  elements['ams-unmute-btn'].dispatch('click');
  assert.equal(audio.muted, false);
  assert.equal(audio.volume, 1);
  assert.equal(requests.length, 2);
  requests[1].resolve();
  audio.dispatch('playing');
  requests[0].reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  await flush();
  assert.equal(audio.muted, false);
  assert.equal(elements['ams-sound-hint'].classList.contains('hidden'), true);
  assert.equal(elements['ams-now-playing-title'].textContent, 'Now playing: sma$her & MC DA$ILVA — BAILA LENTO');
});

test('blocked playback shows a retry button, not a now-playing claim', async () => {
  const { elements, requests } = setup();
  requests[0].reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  await flush();
  assert.equal(elements['ams-sound-label'].textContent, 'Tap to play sound');
  assert.equal(elements['ams-now-playing'].classList.contains('hidden'), true);
  elements['ams-unmute-btn'].dispatch('click');
  assert.equal(requests.length, 2);
});

test('failed tracks stop after one playlist cycle and can be retried', () => {
  const { elements, audio, requests } = setup();
  audio.error = {};
  audio.dispatch('error');
  assert.equal(audio.src, '/audio/tulin-tulin-phonk.mp3');
  audio.error = {};
  audio.dispatch('error');
  assert.equal(elements['ams-sound-label'].textContent, 'Audio unavailable — tap to retry');
  assert.equal(requests.length, 2);
  elements['ams-unmute-btn'].dispatch('click');
  assert.equal(requests.length, 3);
});

test('keyboard activation of the sound button does not dismiss the intro', () => {
  const { document, elements } = setup();
  document.dispatch('keydown', { key: 'Enter' });
  assert.equal(elements['ams-intro-overlay'].classList.contains('opacity-0'), false);
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal(elements['ams-intro-overlay'].classList.contains('opacity-0'), true);
});
