/**
 * Browser-side image compression, shared by every upload surface in the panel:
 * the editor's media picker, the featured-image dialog, Media → Add Media File
 * and images pasted/dropped into the editor.
 *
 * The old pass encoded once at a fixed WebP quality, so a 515 KB photo could
 * still land at 370 KB. This pass is size-targeted: it decodes the picture once,
 * then searches WebP quality and, when needed, pixel dimensions until the encoded
 * file fits the requested ceiling (100 KB by default). A 10 MB camera original is
 * therefore reduced to the same target, not merely "a bit smaller".
 *
 * Rules:
 *  - GIF, SVG and APNG are left untouched (animation / vector).
 *  - Animated WebP and animated PNG detected in the file header are kept too.
 *  - Static WebP/AVIF are no longer exempt: if they are over the target they are
 *    re-encoded like JPEG/PNG.
 *  - A file already under the target is kept as selected.
 *  - Formats the browser cannot decode (HEIC on Chrome, TIFF, JXL …) are
 *    reported back so the caller can explain, instead of storing a broken image.
 *  - Everything runs locally: no image ever leaves the page for processing.
 *
 * `window.amsCompressImages(files, { targetKB, quality, maxEdge, convert })`
 * resolves to `[{ file, original, changed, failed, note, width, height, quality,
 * targetBytes }]`; `file` is always safe to upload. `quality` is the ceiling for
 * the search, not a fixed output quality. Batches run one image at a time so a
 * drop of 20 phone photos does not decode 20 bitmaps into memory at once.
 */
export const MEDIA_COMPRESS_JS = `<script>
(function () {
  'use strict';
  if (window.amsCompressImages) return;

  var DEFAULT_TARGET_KB = 100;
  var MAX_EDGE = 2000;
  var MIN_QUALITY = 0.05;
  var MAX_QUALITY = 0.9;
  var SKIP = /^image\\/(gif|svg\\+xml|apng)$/i;
  var webpOk = null;

  function webpSupported() {
    if (webpOk !== null) return webpOk;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      webpOk = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (err) {
      webpOk = false;
    }
    return webpOk;
  }

  function baseName(name) {
    var dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  function positive(value, fallback) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? value : fallback;
  }

  function viaElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function decode(file) {
    if (!window.createImageBitmap) return viaElement(file);
    return createImageBitmap(file, { imageOrientation: 'from-image' })
      .catch(function () { return createImageBitmap(file); })
      .catch(function () { return viaElement(file); });
  }

  function encode(canvas, quality) {
    return new Promise(function (resolve) {
      if (typeof canvas.toBlob !== 'function') { resolve(null); return; }
      canvas.toBlob(function (blob) { resolve(blob); }, 'image/webp', quality);
    });
  }

  /* Canvas decodes only the first frame of an animated WebP/PNG. Keep those
     files whole rather than silently flattening them into a still image. */
  function isAnimated(file) {
    if (!/^image\\/(webp|png|apng)$/i.test(file.type) || typeof file.slice !== 'function') return Promise.resolve(false);
    return file.slice(0, 65536).arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      var view = new DataView(buffer);
      function tag(offset, text) {
        if (offset + text.length > bytes.length) return false;
        for (var i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
        return true;
      }
      var offset, size;
      if (tag(0, 'RIFF') && tag(8, 'WEBP')) {
        offset = 12;
        while (offset + 8 <= bytes.length) {
          if (tag(offset, 'ANIM') || tag(offset, 'ANMF')) return true;
          size = view.getUint32(offset + 4, true);
          offset += 8 + size + (size & 1);
        }
        return false;
      }
      if (tag(0, '\\u0089PNG\\r\\n\\u001a\\n')) {
        offset = 8;
        while (offset + 8 <= bytes.length) {
          if (tag(offset + 4, 'acTL')) return true;
          if (tag(offset + 4, 'IDAT')) return false;
          size = view.getUint32(offset, false);
          offset += 12 + size;
        }
      }
      return false;
    }).catch(function () { return false; });
  }

  /* Search the largest quality that fits at the current dimensions. If even the
     minimum quality is too big, jump the long edge down by the area ratio and
     try again. The original bitmap is redrawn each round, so repeated resizing
     never compounds blur. */
  async function fit(image, targetBytes, maxEdge, ceiling) {
    var width = image.width || image.naturalWidth || 0;
    var height = image.height || image.naturalHeight || 0;
    if (!width || !height) throw new Error('decode');
    var sourceEdge = Math.max(width, height);
    var edge = Math.min(maxEdge, sourceEdge);
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    var best = null;

    while (edge >= 1) {
      var scale = Math.min(1, edge / sourceEdge);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      var hiBlob = await encode(canvas, ceiling);
      if (hiBlob && hiBlob.size && hiBlob.size <= targetBytes) {
        best = { blob: hiBlob, quality: ceiling, width: canvas.width, height: canvas.height };
        break;
      }
      var loBlob = await encode(canvas, MIN_QUALITY);
      if (!loBlob || !loBlob.size) break;
      if (loBlob.size <= targetBytes) {
        best = { blob: loBlob, quality: MIN_QUALITY, width: canvas.width, height: canvas.height };
        var low = MIN_QUALITY, high = ceiling;
        for (var i = 0; i < 6 && high - low > 0.01; i++) {
          var mid = (low + high) / 2;
          var blob = await encode(canvas, mid);
          if (blob && blob.size && blob.size <= targetBytes) {
            best = { blob: blob, quality: mid, width: canvas.width, height: canvas.height };
            low = mid;
          } else {
            high = mid;
          }
        }
        break;
      }
      if (edge <= 1) break;
      var factor = Math.min(0.85, Math.sqrt(targetBytes / loBlob.size) * 0.92);
      var next = Math.max(1, Math.floor(edge * factor));
      edge = next >= edge ? edge - 1 : next;
    }
    return best;
  }

  async function compress(file, options) {
    var opts = options || {};
    var result = {
      file: file, original: file, changed: false, failed: false, note: '',
      width: 0, height: 0, quality: 0, targetBytes: 0,
    };
    if (opts.convert === false) {
      result.note = 'kept as selected';
      return result;
    }
    if (!file || !file.type || !/^image\\//i.test(file.type)) {
      result.note = 'not an image';
      return result;
    }
    if (SKIP.test(file.type)) {
      result.note = file.type === 'image/gif' ? 'GIF kept, animation preserved'
        : file.type === 'image/apng' ? 'APNG kept, animation preserved'
        : 'SVG kept, vector';
      return result;
    }

    var targetKB = positive(opts.targetKB, DEFAULT_TARGET_KB);
    var targetBytes = Math.max(1, Math.round(targetKB * 1024));
    var maxEdge = Math.max(1, Math.round(positive(opts.maxEdge, MAX_EDGE)));
    var ceiling = Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, positive(opts.quality, MAX_QUALITY)));
    result.targetBytes = targetBytes;

    if (file.size <= targetBytes) {
      result.note = 'already under ' + fmtSize(targetBytes) + ' target';
      return result;
    }
    if (!webpSupported()) {
      result.note = 'this browser cannot make WebP, uploaded as-is';
      return result;
    }
    if (await isAnimated(file)) {
      result.note = (file.type === 'image/webp' ? 'animated WebP' : 'animated PNG') + ' kept, animation preserved';
      return result;
    }

    var image = null;
    try {
      image = await decode(file);
      var best = await fit(image, targetBytes, maxEdge, ceiling);
      if (!best) {
        result.failed = true;
        result.note = 'could not compress below ' + fmtSize(targetBytes) + ' in this browser';
        return result;
      }
      var out = new File([best.blob], baseName(file.name) + '.webp', { type: 'image/webp', lastModified: Date.now() });
      var ratio = 1 - out.size / file.size;
      result.file = out;
      result.changed = true;
      result.width = best.width;
      result.height = best.height;
      result.quality = best.quality;
      result.note = ratio < 0.01
        ? fmtSize(file.size) + ' to ' + fmtSize(out.size)
        : Math.round(ratio * 100) + '% smaller · ' + best.width + '×' + best.height;
      return result;
    } catch (err) {
      result.failed = true;
      result.note = 'this browser cannot read ' + (file.type.replace('image/', '').toUpperCase() || 'that format');
      return result;
    } finally {
      if (image && image.close) image.close();
    }
  }

  window.amsFmtSize = fmtSize;
  window.amsCompressImage = compress;
  window.amsCompressImages = function (files, options) {
    var list = Array.prototype.slice.call(files || []);
    return list.reduce(function (chain, file) {
      return chain.then(function (results) {
        return compress(file, options).then(function (result) { results.push(result); return results; });
      });
    }, Promise.resolve([]));
  };
  window.amsWebpSupported = webpSupported;
})();
</script>`;
