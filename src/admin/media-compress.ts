/**
 * Browser-side image compression, shared by every upload surface in the panel:
 * the editor's media picker, the featured-image dialog and Media → Add Media
 * File. Raster images are decoded, downscaled to a sane web size and encoded as
 * WebP at a tight quality, so what reaches KV/disk (and every visitor) is a
 * fraction of the camera original. Conversion happens before the request, which
 * also keeps the server free of native image libraries and works identically on
 * Cloudflare Workers and Node.js.
 *
 * Rules:
 *  - GIF and SVG are left untouched (they can be animated / vector).
 *  - WebP and AVIF are left untouched (already modern and usually smaller).
 *  - A converted file is only used when it is actually smaller.
 *  - Formats the browser cannot decode (HEIC on Chrome, TIFF, JXL …) are
 *    reported back so the caller can explain, instead of storing a broken image.
 *  - Everything runs locally: no image ever leaves the page for processing.
 *
 * `window.amsCompressImages(files, { quality, maxEdge, convert })` resolves to
 * `[{ file, original, changed, failed, note }]`; `file` is always safe to upload.
 */
export const MEDIA_COMPRESS_JS = `<script>
(function () {
  'use strict';
  if (window.amsCompressImages) return;

  var MAX_EDGE = 2000;
  var SKIP = /^image\\/(gif|svg\\+xml)$/i;
  var MODERN = /^image\\/(webp|avif)$/i;
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

  function compress(file, options) {
    var opts = options || {};
    var quality = typeof opts.quality === 'number' ? opts.quality : 0.7;
    var maxEdge = opts.maxEdge || MAX_EDGE;
    var result = { file: file, original: file, changed: false, failed: false, note: '' };

    if (opts.convert === false) {
      result.note = 'kept as selected';
      return Promise.resolve(result);
    }
    if (!file || !file.type || !/^image\\//i.test(file.type)) {
      result.note = 'not an image';
      return Promise.resolve(result);
    }
    if (SKIP.test(file.type)) {
      result.note = file.type === 'image/gif' ? 'GIF kept, animation preserved' : 'SVG kept, vector';
      return Promise.resolve(result);
    }
    if (MODERN.test(file.type)) {
      result.note = 'already WebP or AVIF';
      return Promise.resolve(result);
    }
    if (!webpSupported()) {
      result.note = 'this browser cannot make WebP, uploaded as-is';
      return Promise.resolve(result);
    }

    return decode(file).then(function (image) {
      var width = image.width || image.naturalWidth || 0;
      var height = image.height || image.naturalHeight || 0;
      if (!width || !height) throw new Error('decode');
      var scale = Math.min(1, maxEdge / Math.max(width, height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      var ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (image.close) image.close();
      return encode(canvas, quality);
    }).then(function (blob) {
      if (!blob || !blob.size) {
        result.note = 'kept as selected';
        return result;
      }
      // Tiny originals can encode larger; keeping the smaller file wins.
      if (blob.size >= file.size) {
        result.note = 'already smaller than WebP';
        return result;
      }
      var out = new File([blob], baseName(file.name) + '.webp', { type: 'image/webp', lastModified: Date.now() });
      var ratio = 1 - out.size / file.size;
      result.file = out;
      result.changed = true;
      result.note = ratio < 0.01
        ? fmtSize(file.size) + ' to ' + fmtSize(out.size)
        : Math.round(ratio * 100) + '% smaller';
      return result;
    }).catch(function () {
      result.failed = true;
      result.note = 'this browser cannot read ' + (file.type.replace('image/', '').toUpperCase() || 'that format');
      return result;
    });
  }

  window.amsFmtSize = fmtSize;
  window.amsCompressImage = compress;
  window.amsCompressImages = function (files, options) {
    var list = Array.prototype.slice.call(files || []);
    return Promise.all(list.map(function (file) { return compress(file, options); }));
  };
  window.amsWebpSupported = webpSupported;
})();
</script>`;
