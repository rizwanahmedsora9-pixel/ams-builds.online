// Unit tests for the browser-side image compressor (src/admin/media-compress.ts).
//
//   npm run build && node --test tests/media-compress.test.mjs
//
// The compressor is a browser script, so it is tested the way the browser gets
// it: the exact <script> body is pulled from a real editor page and run in a VM
// with a fake canvas. That keeps the test honest about what ships, while letting
// us prove the parts that matter: the size target is actually met, quality is
// searched before dimensions are sacrificed, animated/vector files are kept,
// modern formats are no longer exempt, and the failure paths stay safe.
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
 *  - `encode`        bytes the fake WebP encoder returns: (width, height, quality)
 *  - `webp`          whether canvas.toDataURL('image/webp') claims support
 *  - `decodeFails`   createImageBitmap and <img> both reject
 */
function boot({
  dims = { width: 4000, height: 3000 },
  encode = (width, height, quality) => Math.round((width * height * quality) / 20),
  webp = true,
  decodeFails = false,
} = {}) {
  const seen = { encode: [], canvases: 0 };
  class FakeImage {
    set src(_value) { setTimeout(() => this.onerror && this.onerror(new Error('decode')), 0); }
  }
  const makeCanvas = () => ({
    width: 0,
    height: 0,
    getContext() {
      const canvas = this; // eslint-disable-line no-invalid-this
      return {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage(_img, _dx, _dy, width, height) { canvas.drawn = { width, height }; },
      };
    },
    toDataURL(type) {
      return webp && type === 'image/webp' ? 'data:image/webp;base64,AAAA' : 'data:image/png;base64,AAAA';
    },
    toBlob(callback, type, quality) {
      seen.canvases++;
      seen.encode.push({ type, quality, width: this.width, height: this.height });
      callback(new Blob([new Uint8Array(Math.max(0, encode(this.width, this.height, quality)))], { type: type || 'image/webp' }));
    },
  });
  const context = {
    console, Blob, File, Promise, setTimeout, clearTimeout, Uint8Array, DataView,
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
const TARGET = 100 * 1024;

/** A minimal animated WebP: RIFF/WEBP with an ANIM chunk right at the start. */
function animatedWebp(bytes) {
  const data = new Uint8Array(bytes);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) data[offset + i] = text.charCodeAt(i); };
  write(0, 'RIFF'); write(8, 'WEBP'); write(12, 'ANIM');
  return new File([data], 'loop.webp', { type: 'image/webp' });
}

/** A minimal animated PNG: PNG signature with an acTL chunk before IDAT. */
function animatedPng(bytes) {
  const data = new Uint8Array(bytes);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) data[offset + i] = text.charCodeAt(i); };
  write(0, '\u0089PNG\r\n\u001a\n'); write(12, 'acTL');
  return new File([data], 'loop.png', { type: 'image/png' });
}

test('a 10 MB camera original is compressed to the default 100 KB target', async () => {
  const { context, seen } = boot({ dims: { width: 6000, height: 4000 } });
  const [result] = await context.amsCompressImages([file(10_000_000, 'holiday.JPG', 'image/jpeg')]);

  assert.equal(result.changed, true);
  assert.equal(result.failed, false);
  assert.equal(result.file.type, 'image/webp');
  assert.equal(result.file.name, 'holiday.webp', 'the name follows the new format');
  assert.ok(result.file.size <= TARGET, `output ${result.file.size} must fit ${TARGET}`);
  assert.equal(result.original.size, 10_000_000, 'the original is kept for the caller');
  assert.equal(result.targetBytes, TARGET);
  assert.equal(result.width, 2000);
  assert.equal(result.height, 1333);
  assert.ok(seen.encode.length > 1, 'quality is searched, not encoded once at a fixed setting');
  assert.ok(seen.encode.every((call) => call.type === 'image/webp' && call.quality <= 0.9));
  assert.match(result.note, /% smaller/);
});

test('the reported 515 KB case no longer stops at a few hundred KB', async () => {
  const { context } = boot({ dims: { width: 2400, height: 1600 } });
  const [result] = await context.amsCompressImages([file(515_000, 'photo.jpg', 'image/jpeg')]);
  assert.equal(result.changed, true);
  assert.ok(result.file.size <= TARGET, `output ${result.file.size} must fit ${TARGET}`);
});

test('when quality alone cannot fit the target, dimensions are reduced until it does', async () => {
  // This fake encoder ignores quality, so the only way under the ceiling is to
  // draw a smaller canvas. The compressor must keep going instead of giving up.
  const { context, seen } = boot({
    dims: { width: 4000, height: 3000 },
    encode: (width, height) => Math.round((width * height) / 10),
  });
  const [result] = await context.amsCompressImages([file(2_000_000, 'noisy.png', 'image/png')]);
  assert.equal(result.failed, false);
  assert.equal(result.changed, true);
  assert.ok(result.file.size <= TARGET);
  assert.ok(result.width < 2000, 'the long edge was reduced below the initial cap');
  assert.ok(seen.encode.some((call) => call.width < 2000));
});

test('small images are never upscaled, and portrait images are capped too', async () => {
  const small = boot({ dims: { width: 800, height: 600 } });
  await small.context.amsCompressImages([file(200_000, 'icon.png', 'image/png')]);
  assert.equal(small.seen.encode[0].width, 800);
  assert.equal(small.seen.encode[0].height, 600);

  const tall = boot({ dims: { width: 3000, height: 6000 } });
  await tall.context.amsCompressImages([file(900_000, 'poster.png', 'image/png')]);
  assert.equal(tall.seen.encode[0].width, 1000);
  assert.equal(tall.seen.encode[0].height, 2000);
});

test('a smaller target and a quality ceiling are both honoured', async () => {
  const small = boot();
  const [result] = await small.context.amsCompressImages([file(300_000, 'photo.jpg', 'image/jpeg')], { targetKB: 50 });
  assert.ok(result.file.size <= 50 * 1024);
  assert.equal(result.targetBytes, 50 * 1024);

  const ceiling = boot();
  await ceiling.context.amsCompressImages([file(300_000, 'photo.jpg', 'image/jpeg')], { quality: 0.6 });
  assert.equal(ceiling.seen.encode[0].quality, 0.6);
  assert.ok(ceiling.seen.encode.every((call) => call.quality <= 0.6));

  const keep = boot();
  const [kept] = await keep.context.amsCompressImages([file(300_000, 'photo.jpg', 'image/jpeg')], { convert: false });
  assert.equal(kept.changed, false);
  assert.equal(kept.file.name, 'photo.jpg');
  assert.equal(keep.seen.canvases, 0, 'nothing is decoded when conversion is off');
  assert.equal(kept.note, 'kept as selected');
});

test('animation and vectors pass through untouched', async () => {
  const { context, seen } = boot();
  const cases = [
    [file(400_000, 'asset.gif', 'image/gif'), /GIF kept/],
    [file(400_000, 'asset.svg', 'image/svg+xml'), /SVG kept/],
    [file(400_000, 'asset.apng', 'image/apng'), /APNG kept/],
    [animatedWebp(400_000), /animated WebP kept/],
    [animatedPng(400_000), /animated PNG kept/],
  ];
  for (const [input, note] of cases) {
    const [result] = await context.amsCompressImages([input]);
    assert.equal(result.file, input, `${input.name} is uploaded as-is`);
    assert.equal(result.changed, false);
    assert.match(result.note, note);
  }
  assert.equal(seen.canvases, 0, 'no canvas work for files that must not change');
});

test('static WebP and AVIF are no longer exempt when they are over the target', async () => {
  const { context } = boot();
  const [webp] = await context.amsCompressImages([file(400_000, 'still.webp', 'image/webp')]);
  assert.equal(webp.changed, true);
  assert.ok(webp.file.size <= TARGET);

  const [avif] = await context.amsCompressImages([file(400_000, 'still.avif', 'image/avif')]);
  assert.equal(avif.changed, true);
  assert.ok(avif.file.size <= TARGET);

  const [small] = await context.amsCompressImages([file(80_000, 'already.webp', 'image/webp')]);
  assert.equal(small.changed, false);
  assert.match(small.note, /already under 100 KB target/);
});

test('a file already under the target is kept instead of re-encoded', async () => {
  const { context, seen } = boot();
  const [result] = await context.amsCompressImages([file(90_000, 'tiny.jpg', 'image/jpeg')]);
  assert.equal(result.changed, false);
  assert.equal(result.file.name, 'tiny.jpg');
  assert.match(result.note, /already under 100 KB target/);
  assert.equal(seen.canvases, 0);
});

test('if even a 1 px encode cannot fit the target, the failure is reported', async () => {
  const { context } = boot({ encode: () => 200_000 });
  const [result] = await context.amsCompressImages([file(300_000, 'tiny.png', 'image/png')]);
  assert.equal(result.changed, false);
  assert.equal(result.failed, true);
  assert.equal(result.file.name, 'tiny.png');
  assert.match(result.note, /could not compress below 100 KB/);
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

test('a batch keeps its order, runs one image at a time, and formats sizes for humans', async () => {
  const { context, seen } = boot({ encode: () => 40_000 });
  const results = await context.amsCompressImages([
    file(200_000, 'one.jpg', 'image/jpeg'),
    file(200_000, 'two.png', 'image/png'),
    file(1_000, 'three.gif', 'image/gif'),
  ]);
  assert.equal(results.length, 3);
  assert.equal(results[0].changed, true);
  assert.equal(results[1].changed, true);
  assert.equal(results[2].changed, false);
  assert.equal(seen.canvases, 2);

  assert.equal(context.amsFmtSize(500), '1 KB');
  assert.equal(context.amsFmtSize(2048), '2 KB');
  assert.equal(context.amsFmtSize(1_572_864), '1.5 MB');
});
