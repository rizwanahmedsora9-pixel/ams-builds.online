/**
 * Media picker - one dialog, used from three places: the featured image on a
 * post, the body's Media button, and Appearance → Identity. It queries the
 * media library over HTTP (so it always shows what is really there) and offers
 * two tabs: images already uploaded, and an upload panel that takes files from
 * the device (click or drag and drop).
 *
 * Uploads are compressed in the browser to tight WebP before they are sent
 * (see src/admin/media-compress.ts), so adding a photo from inside the editor
 * never ships a 6 MB camera file to visitors. Alt text is set in the same pass.
 *
 * The dialog is server-rendered into the page; the client script fills the grid
 * from `GET /{admin}/media/picker?type=image&q=…` and hands the chosen URL back
 * to whoever opened it via a callback registered on `window.amsMediaPicker`.
 */
import { icon } from './icons';
import { IMAGE_ACCEPT } from '../lib/media-types';
import { MEDIA_COMPRESS_JS } from './media-compress';

export type PickerItem = { id: number; url: string; filename: string; alt: string; mime: string };

/** Markup for the <dialog>. Include once per page that needs it. */
export function mediaPicker(opts: {
  endpoint?: string;
  uploadUrl?: string;
  csrf?: string;
  accept?: string;
} = {}): string {
  const endpoint = opts.endpoint ?? '';
  const uploadUrl = opts.uploadUrl ?? '';
  const csrf = opts.csrf ?? '';
  const accept = opts.accept ?? IMAGE_ACCEPT;
  return `<dialog id="media-picker" class="media-picker" aria-labelledby="media-picker-title"
        data-endpoint="${endpoint}"${endpoint ? '' : ' data-picker-disabled'}>
  <header class="media-picker__head">
    <h2 id="media-picker-title">Add media</h2>
    <button class="media-picker__close" type="button" data-picker-close aria-label="Close">${icon('x')}</button>
  </header>
  <div class="media-picker__tabs" role="tablist" aria-label="Where the image comes from">
    <button type="button" role="tab" id="media-picker-tab-library" aria-controls="media-picker-panel-library"
      aria-selected="true" data-picker-tab="library">Library</button>
    <button type="button" role="tab" id="media-picker-tab-upload" aria-controls="media-picker-panel-upload"
      aria-selected="false" tabindex="-1" data-picker-tab="upload">Upload from device</button>
  </div>
  <section id="media-picker-panel-library" role="tabpanel" aria-labelledby="media-picker-tab-library"
    class="media-picker__panel" data-picker-panel="library">
    <form class="media-picker__search" method="get" data-picker-form>
      <span class="palette__ico">${icon('search')}</span>
      <label class="sr-only" for="media-picker-q">Search the media library</label>
      <input type="search" id="media-picker-q" name="q" placeholder="Search by file name or alt text…" autocomplete="off">
    </form>
    <div class="media-picker__body">
      <div class="media-picker__grid" data-picker-grid role="list"></div>
      <p class="sr-only" id="media-picker-status" role="status" aria-live="polite"></p>
    </div>
  </section>
  <section id="media-picker-panel-upload" role="tabpanel" aria-labelledby="media-picker-tab-upload"
    class="media-picker__panel" data-picker-panel="upload" hidden>
    <form method="post" action="${uploadUrl}" enctype="multipart/form-data" class="media-picker__upload" data-picker-upload>
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="media-picker__drop" for="media-picker-file" data-picker-drop>
        <span class="media-picker__drop-icon">${icon('upload')}</span>
        <b>Drop images here, or click to browse</b>
        <span class="hint">JPG, PNG, GIF, WebP, AVIF, BMP, TIFF, HEIC, SVG and more. Raster images are resized and re-encoded as tight WebP; a format this browser cannot read is flagged before anything is sent.</span>
        <input type="file" id="media-picker-file" name="files" accept="${accept}" multiple>
      </label>
      <div class="media-picker__queue" data-picker-queue aria-live="polite"></div>
      <div class="media-picker__options">
        <label for="media-picker-quality">Image quality</label>
        <select id="media-picker-quality" data-picker-quality>
          <option value="0.7" selected>Tight — smallest WebP (recommended)</option>
          <option value="0.8">Balanced</option>
          <option value="0.9">High</option>
          <option value="0">Keep originals, no conversion</option>
        </select>
      </div>
      <p class="hint media-picker__compress-note">Compression happens in your browser before upload, so the file the site serves is the small one. GIF animation and SVG stay as they are. Up to 20 images at a time.</p>
      <p class="row media-picker__upload-actions">
        <button class="btn" type="submit" data-picker-upload-btn disabled>Upload</button>
        <span class="hint" data-picker-upload-status role="status" aria-live="polite"></span>
      </p>
    </form>
  </section>
  <footer class="media-picker__foot">
    <label for="media-picker-alt">Alt text</label>
    <input type="text" id="media-picker-alt" name="alt" maxlength="200" placeholder="Describe the image for screen readers">
    <p class="hint">Saved with the image you pick, and added to new uploads. Leave it empty only for decoration.</p>
    <p class="row dialog-actions">
      <button class="btn ghost" type="button" data-picker-close>Cancel</button>
      <button class="btn" type="button" data-picker-insert disabled>Use this image</button>
    </p>
  </footer>
</dialog>`;
}

/**
 * Client script: library grid, search, tabs, drag-and-drop upload and the
 * compression pass. `open({ onPick, tab })` opens the dialog; the caller decides
 * what to do with `{ url, alt, id }`.
 */
export const PICKER_JS = `${MEDIA_COMPRESS_JS}<script>
(function () {
  'use strict';
  window.amsMediaPicker = function (options) {
    var dialog = document.getElementById('media-picker');
    if (!dialog || dialog.hasAttribute('data-picker-disabled') || typeof dialog.showModal !== 'function') return null;
    var grid = dialog.querySelector('[data-picker-grid]');
    var search = dialog.querySelector('#media-picker-q');
    var altInput = dialog.querySelector('#media-picker-alt');
    var uploadForm = dialog.querySelector('[data-picker-upload]');
    var fileInput = dialog.querySelector('#media-picker-file');
    var quality = dialog.querySelector('[data-picker-quality]');
    var queue = dialog.querySelector('[data-picker-queue]');
    var uploadBtn = dialog.querySelector('[data-picker-upload-btn]');
    var uploadStatus = dialog.querySelector('[data-picker-upload-status]');
    var insert = dialog.querySelector('[data-picker-insert]');
    var endpoint = dialog.getAttribute('data-endpoint') || '';
    var tabs = Array.prototype.slice.call(dialog.querySelectorAll('[data-picker-tab]'));
    var panels = Array.prototype.slice.call(dialog.querySelectorAll('[data-picker-panel]'));
    var live = document.getElementById('media-picker-status');
    var chosen = null, timer = null, onPick = null;
    var sourceFiles = [], prepared = [], busy = false, autoSelect = null;

    function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmt(bytes) {
      return window.amsFmtSize ? window.amsFmtSize(bytes) : Math.max(1, Math.round((bytes || 0) / 1024)) + ' KB';
    }

    /* ------------------------------------------------------------ tabs */
    function switchTab(name) {
      if (name !== 'upload') name = 'library';
      tabs.forEach(function (tab) {
        var on = tab.getAttribute('data-picker-tab') === name;
        tab.setAttribute('aria-selected', String(on));
        tab.setAttribute('tabindex', on ? '0' : '-1');
      });
      panels.forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-picker-panel') !== name;
      });
      if (name === 'library' && search) search.focus();
    }

    /* -------------------------------------------------------- selection */
    function choose(item) {
      chosen = item;
      grid.querySelectorAll('[data-picker-item]').forEach(function (el) {
        el.setAttribute('aria-current', String(Number(el.getAttribute('data-id')) === item.id));
      });
      altInput.value = item.alt || '';
      insert.disabled = false;
    }
    function selectById(id) {
      var button = grid.querySelector('[data-picker-item][data-id="' + id + '"]');
      if (!button) return;
      choose({
        id: Number(button.getAttribute('data-id')),
        url: button.getAttribute('data-url'),
        alt: button.getAttribute('data-alt'),
        filename: button.getAttribute('data-filename'),
      });
      if (button.scrollIntoView) button.scrollIntoView({ block: 'nearest' });
    }

    /* ------------------------------------------------------------ grid */
    function render(items) {
      if (!items.length) {
        grid.innerHTML = '<p class="hint media-picker__empty">No images in the library yet. ' +
          '<button type="button" class="btn ghost small" data-picker-go-upload>Upload one now</button></p>';
        chosen = null;
        insert.disabled = true;
        return;
      }
      grid.innerHTML = items.map(function (item) {
        return '<button type="button" class="media-picker__item" role="listitem" data-picker-item' +
          ' data-id="' + item.id + '" data-url="' + esc(item.url) + '" data-alt="' + esc(item.alt) +
          '" data-filename="' + esc(item.filename) + '" aria-current="false">' +
          '<img src="' + esc(item.url) + '" alt="" loading="lazy">' +
          '<span>' + esc(item.filename) + '</span></button>';
      }).join('');
      grid.querySelectorAll('[data-picker-item]').forEach(function (button) {
        button.addEventListener('click', function () {
          choose({
            id: Number(button.getAttribute('data-id')),
            url: button.getAttribute('data-url'),
            alt: button.getAttribute('data-alt'),
            filename: button.getAttribute('data-filename'),
          });
        });
      });
      chosen = null;
      insert.disabled = true;
      if (autoSelect !== null) {
        selectById(autoSelect);
        autoSelect = null;
      }
    }

    function load(query) {
      if (!endpoint) return Promise.resolve();
      return fetch(endpoint + (query ? '?q=' + encodeURIComponent(query) : ''), { credentials: 'same-origin' })
        .then(function (res) { return res.ok ? res.json() : { items: [] }; })
        .then(function (data) {
          var items = data.items || [];
          render(items);
          if (live) live.textContent = items.length + (items.length === 1 ? ' image' : ' images');
        })
        .catch(function () { render([]); });
    }

    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { load(search.value.trim()); }, 150);
    });
    // Enter searches in place; a plain form submit would navigate away from the editor.
    var searchForm = dialog.querySelector('[data-picker-form]');
    if (searchForm) searchForm.addEventListener('submit', function (event) {
      event.preventDefault();
      clearTimeout(timer);
      load(search.value.trim());
    });

    /* ---------------------------------------------------------- upload */
    function qualityValue() {
      var value = quality ? parseFloat(quality.value) : 0.7;
      return isNaN(value) ? 0.7 : value;
    }
    function queueRows(rows) {
      queue.innerHTML = rows.map(function (row) {
        var result = row.result;
        var detail = result.note || '';
        if (result.file && result.file.size) detail = (result.changed ? result.file.name + ' · ' : '') + fmt(result.file.size) + (detail ? ' · ' + detail : '');
        return '<li class="media-picker__queue-item' + (result.failed ? ' is-warn' : '') + '">' +
          '<b>' + esc(row.name) + '</b><span>' + esc(detail) + '</span></li>';
      }).join('');
    }
    function resetUpload() {
      sourceFiles = [];
      prepared = [];
      busy = false;
      if (uploadForm) uploadForm.reset();
      if (queue) queue.innerHTML = '';
      if (uploadBtn) uploadBtn.disabled = true;
      if (uploadStatus) uploadStatus.textContent = '';
    }
    function prepareFiles(files) {
      sourceFiles = Array.prototype.slice.call(files || []).filter(function (file) { return file && file.size; });
      prepared = [];
      if (!sourceFiles.length) {
        resetUpload();
        return;
      }
      switchTab('upload');
      var value = qualityValue();
      var options = value > 0 ? { quality: value } : { convert: false };
      busy = true;
      uploadBtn.disabled = true;
      uploadStatus.textContent = (value > 0 ? 'Optimising ' : 'Preparing ') + sourceFiles.length +
        (sourceFiles.length === 1 ? ' image' : ' images') + (value > 0 ? ' to WebP…' : '…');
      queueRows(sourceFiles.map(function (file) {
        return { name: file.name, result: { file: file, original: file, failed: false, changed: false, note: 'working…' } };
      }));
      var done = function (results) {
        prepared = results.map(function (result, index) {
          return { name: (sourceFiles[index] || result.original).name, result: result };
        });
        busy = false;
        queueRows(prepared);
        var usable = prepared.filter(function (row) { return !row.result.failed; });
        uploadBtn.disabled = usable.length === 0;
        if (!usable.length) {
          uploadStatus.textContent = 'None of these could be read by this browser. Try JPG, PNG, WebP or AVIF.';
        } else {
          var saved = prepared.reduce(function (n, row) {
            return n + Math.max(0, (row.result.original.size || 0) - (row.result.file.size || 0));
          }, 0);
          uploadStatus.textContent = usable.length + (usable.length === 1 ? ' image ready' : ' images ready') +
            (saved > 0 ? ', ' + fmt(saved) + ' saved' : '') + '.';
        }
      };
      if (!window.amsCompressImages) {
        done(sourceFiles.map(function (file) {
          return { file: file, original: file, failed: false, changed: false, note: '' };
        }));
        return;
      }
      window.amsCompressImages(sourceFiles, options).then(done).catch(function () { busy = false; uploadBtn.disabled = false; });
    }
    if (fileInput) fileInput.addEventListener('change', function () {
      prepareFiles(fileInput.files);
    });
    if (quality) quality.addEventListener('change', function () {
      if (sourceFiles.length) prepareFiles(sourceFiles);
    });
    if (uploadForm) uploadForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (busy) return;
      var usable = prepared.filter(function (row) { return !row.result.failed; });
      if (!usable.length) {
        uploadStatus.textContent = 'Choose at least one image first.';
        return;
      }
      var action = uploadForm.getAttribute('action') || '';
      if (!action) {
        uploadStatus.textContent = 'Upload is not available here. Open Media → Add Media File instead.';
        return;
      }
      var body = new FormData(uploadForm);
      body.delete('files');
      body.delete('file');
      var alt = altInput.value.trim();
      if (alt) body.set('alt', alt); else body.delete('alt');
      usable.forEach(function (row) {
        body.append('files', row.result.file, row.result.file.name);
      });
      busy = true;
      uploadBtn.disabled = true;
      uploadStatus.textContent = 'Uploading ' + usable.length + (usable.length === 1 ? ' image…' : ' images…');
      fetch(action, { method: 'POST', body: body, credentials: 'same-origin' })
        .then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (data) {
          busy = false;
          if (!data || !data.ok) {
            uploadStatus.textContent = (data && data.error) || 'Upload failed. Try again.';
            uploadBtn.disabled = false;
            return;
          }
          var items = data.items || (data.item ? [data.item] : []);
          var skipped = (data.skipped || []).length;
          resetUpload();
          uploadStatus.textContent = items.length + (items.length === 1 ? ' image uploaded' : ' images uploaded') +
            (skipped ? ', ' + skipped + ' skipped' : '') + '.';
          if (!items.length) { render([]); return; }
          autoSelect = items[0].id;
          switchTab('library');
          load('').then(function () {
            if (live) live.textContent = items.length + (items.length === 1 ? ' image uploaded and selected.' : ' images uploaded; the first is selected.');
          });
        })
        .catch(function () {
          busy = false;
          uploadBtn.disabled = false;
          uploadStatus.textContent = 'Upload failed. Check your connection and try again.';
        });
    });

    // Drop anywhere in the dialog: jump to the upload tab and take the files.
    dialog.addEventListener('dragover', function (event) {
      if (!event.dataTransfer) return;
      event.preventDefault();
      dialog.classList.add('is-dropping');
    });
    dialog.addEventListener('dragleave', function (event) {
      if (event.target === dialog) dialog.classList.remove('is-dropping');
    });
    dialog.addEventListener('drop', function (event) {
      if (!event.dataTransfer || !event.dataTransfer.files || !event.dataTransfer.files.length) return;
      event.preventDefault();
      dialog.classList.remove('is-dropping');
      prepareFiles(event.dataTransfer.files);
    });

    /* ------------------------------------------------------------ shell */
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { switchTab(tab.getAttribute('data-picker-tab')); });
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        var next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        switchTab(next.getAttribute('data-picker-tab'));
        next.focus();
      });
    });
    grid.addEventListener('click', function (event) {
      var trigger = event.target.closest && event.target.closest('[data-picker-go-upload]');
      if (trigger) switchTab('upload');
    });
    dialog.querySelectorAll('[data-picker-close]').forEach(function (button) {
      button.addEventListener('click', function () { dialog.close(); });
    });
    insert.addEventListener('click', function () {
      if (!chosen) return;
      var item = { id: chosen.id, url: chosen.url, alt: altInput.value.trim() };
      dialog.close();
      if (onPick) onPick(item);
    });

    return {
      open: function (openOpts) {
        var settings = openOpts || {};
        if (!dialog.open) dialog.showModal();
        onPick = settings.onPick || null;
        if (settings.uploadUrl && uploadForm) uploadForm.setAttribute('action', settings.uploadUrl);
        altInput.value = '';
        search.value = '';
        chosen = null;
        insert.disabled = true;
        resetUpload();
        switchTab(settings.tab === 'upload' ? 'upload' : 'library');
        load('');
        setTimeout(function () {
          if (settings.tab === 'upload') {
            if (fileInput) fileInput.focus();
          } else {
            search.focus();
          }
        }, 0);
      },
      search: function (query) {
        switchTab('library');
        search.value = query || '';
        load((query || '').trim());
      },
      close: function () { if (dialog.open) dialog.close(); },
    };
  };
})();
</script>`;
