// Unit tests for the browser-side image compressor (src/admin/media-compress.ts).
//
//   npm run build && node --test tests/media-compress.test.mjs
//
// The compressor is a browser script, so it is tested the way the browser gets
// it: the exact <script> body is pulled from a real editor page and run in a VM
// with a fake canvas. That keeps the test honest about what ships, while letting
// us prove the parts that matter and that a headless browser would only show us
// by accident: downscaling, the WebP quality, the "only use it when smaller"
// rule, the formats that must be left alone, and the failure paths.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHarness } from './helpers.mjs';

const panel = createHarness();
let script = '';

before(async () => {
  await panel.start();
  await panel.install();
  const page = await panel.get(`${panel.admin}/posts/new`);
  const scripts = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  script = scripts.find((body) => body.includes('window.amsCompressImages')) || '';
});

after(async () => {
  await panel.stop();
  panel.cleanup();
});

/**
 * Boots one fresh copy of the shipped script with a fake canvas.
 *  - `dims`          what createImageBitmap reports for the source image
 *  - `encode`        bytes the fake WebP encoder returns, per output canvas
 *  - `webp`          whether canvas.toDataURL('image/webp') claims support
 *  - `decodeFails`   createImageBitmap and <img> both reject
 */
function boot({ dims = { width: 4000, height: 3000 }, encode = () => 120_000, webp = true, decodeFails = false } = {}) {
  const seen = { encode: [], canvases: 0 };
  class FakeImage {
    set src(_value) { setTimeout(() => this.onerror && this.onerror(new Error('decode')), 0); }
  }
  const makeCanvas = () => ({
    width: 0,
    height: 0,
    getContext() {
      const canvas = this; // eslint-disable-line no-invalid-this
      return { drawImage(_img, _dx, _dy, width, height) { canvas.drawn = { width, height }; } };
    },
    toDataURL(type) {
      return webp && type === 'image/webp' ? 'data:image/webp;base64,AAAA' : 'data:image/png;base64,AAAA';
    },
    toBlob(callback, type, quality) {
      seen.canvases++;
      seen.encode.push({ type, quality, width: this.width, height: this.height });
      callback(new Blob([new Uint8Array(Math.max(0, encode(this.width, this.height)))], { type: type || 'image/webp' }));
    },
  });
  const context = {
    console, Blob, File, Promise, setTimeout, clearTimeout,
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
    Image: FakeImage,
    document: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        return makeCanvas();
      },
    },
    createImageBitmap: async () => {
      if (decodeFails) throw new Error('decode');
      return { ...dims, close() {} };
    },
  };
  context.window = context;
  vm.createContext(context);
  assert.ok(script, 'the editor ships the compression script');
  new vm.Script(script).runInContext(context);
  return { context, seen };
}

const file = (bytes, name, type) => new File([new Uint8Array(bytes)], name, { type });

test('a camera-sized JPEG is downscaled and re-encoded as tight WebP', async () => {
  const { context, seen } = boot({ dims: { width: 4000, height: 3000 }, encode: () => 120_000 });
  const [result] = await context.amsCompressImages([file(300_000, 'holiday.JPG', 'image/jpeg')]);

  assert.equal(result.changed, true);
  assert.equal(result.failed, false);
  assert.equal(result.file.type, 'image/webp');
  assert.equal(result.file.name, 'holiday.webp', 'the name follows the new format');
  assert.equal(result.file.size, 120_000);
  assert.equal(result.original.size, 300_000, 'the original is kept for the caller');

  assert.deepEqual(seen.encode, [{ type: 'image/webp', quality: 0.7, width: 2000, height: 1500 }],
    'longest edge is capped at 2000 px and the default quality is the tight one');
  assert.equal(result.note, '60% smaller');
});

test('small images are never upscaled, and portrait images are capped too', async () => {
  const small = boot({ dims: { width: 800, height: 600 }, encode: () => 50_000 });
  await small.context.amsCompressImages([file(200_000, 'icon.png', 'image/png')]);
  assert.equal(small.seen.encode[0].width, 800);
  assert.equal(small.seen.encode[0].height, 600);

  const tall = boot({ dims: { width: 3000, height: 6000 }, encode: () => 50_000 });
  await tall.context.amsCompressImages([file(900_000, 'poster.png', 'image/png')]);
  assert.equal(tall.seen.encode[0].width, 1000);
  assert.equal(tall.seen.encode[0].height, 2000);
});

test('the quality option is honoured, and "no conversion" keeps the original', async () => {
  const sharp = boot({ encode: () => 90_000 });
  await sharp.context.amsCompressImages([file(300_000, 'photo.jpg', 'image/jpeg')], { quality: 0.9 });
  assert.equal(sharp.seen.encode[0].quality, 0.9);

  const keep = boot();
  const [result] = await keep.context.amsCompressImages([file(300_000, 'photo.jpg', 'image/jpeg')], { convert: false });
  assert.equal(result.changed, false);
  assert.equal(result.file.name, 'photo.jpg');
  assert.equal(keep.seen.canvases, 0, 'nothing is decoded when conversion is off');
  assert.equal(result.note, 'kept as selected');
});

test('animation, vectors and already-modern formats pass through untouched', async () => {
  const { context, seen } = boot();
  const cases = [
    ['image/gif', /GIF kept/],
    ['image/svg+xml', /SVG kept/],
    ['image/webp', /already WebP or AVIF/],
    ['image/avif', /already WebP or AVIF/],
  ];
  for (const [type, note] of cases) {
    const input = file(400_000, 'asset.' + type.split('/')[1].replace('+xml', ''), type);
    const [result] = await context.amsCompressImages([input]);
    assert.equal(result.file, input, `${type} is uploaded as-is`);
    assert.equal(result.changed, false);
    assert.match(result.note, note);
  }
  assert.equal(seen.canvases, 0, 'no canvas work for files that must not change');
});

test('a converted file is only used when it is actually smaller', async () => {
  const { context } = boot({ encode: () => 320_000 });
  const [result] = await context.amsCompressImages([file(300_000, 'tiny.png', 'image/png')]);
  assert.equal(result.changed, false);
  assert.equal(result.file.name, 'tiny.png');
  assert.equal(result.note, 'already smaller than WebP');
});

test('a format this browser cannot decode is reported, never uploaded as a broken image', async () => {
  const { context } = boot({ decodeFails: true });
  const [heic] = await context.amsCompressImages([file(200_000, 'IMG_0001.HEIC', 'image/heic')]);
  assert.equal(heic.failed, true);
  assert.equal(heic.changed, false);
  assert.equal(heic.file.name, 'IMG_0001.HEIC');
  assert.match(heic.note, /cannot read HEIC/);

  const [pdf] = await context.amsCompressImages([file(2_000, 'notes.pdf', 'application/pdf')]);
  assert.equal(pdf.failed, false, 'non-images are simply left alone');
  assert.equal(pdf.note, 'not an image');
});

test('without WebP support the original is uploaded instead of a PNG named .webp', async () => {
  const { context, seen } = boot({ webp: false });
  const [result] = await context.amsCompressImages([file(300_000, 'photo.jpg', 'image/jpeg')]);
  assert.equal(result.changed, false);
  assert.equal(result.file.name, 'photo.jpg');
  assert.match(result.note, /cannot make WebP/);
  assert.equal(seen.canvases, 0, 'it never encodes a file it would have to mislabel');
});

test('a batch is compressed in one pass and sizes are formatted for humans', async () => {
  const { context, seen } = boot({ encode: () => 40_000 });
  const results = await context.amsCompressImages([
    file(100_000, 'one.jpg', 'image/jpeg'),
    file(100_000, 'two.png', 'image/png'),
    file(1_000, 'three.gif', 'image/gif'),
  ]);
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.changed), [true, true, false]);
  assert.equal(seen.canvases, 2);

  assert.equal(context.amsFmtSize(500), '1 KB');
  assert.equal(context.amsFmtSize(2048), '2 KB');
  assert.equal(context.amsFmtSize(1_572_864), '1.5 MB');
});
