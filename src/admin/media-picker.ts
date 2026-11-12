/**
 * Media picker - one dialog, used from three places: the featured image on a
 * post, a page hero, and the editor's Insert image button. It queries the media
 * library over HTTP (so it always shows what is really there), and it can
 * upload straight from the dialog, setting alt text at the same time.
 *
 * The dialog is server-rendered into the page; the client script fills the grid
 * from `GET /{admin}/media/picker?type=image&q=…` and hands the chosen URL back
 * to whoever opened it via a callback registered on `window.amsMediaPicker`.
 */
import { icon } from './icons';

export type PickerItem = { id: number; url: string; filename: string; alt: string; mime: string };

/** Markup for the <dialog>. Include once per page that needs it. */
export function mediaPicker(opts: { endpoint?: string } = {}): string {
  return `<dialog id="media-picker" class="media-picker" aria-labelledby="media-picker-title"
        data-endpoint="${opts.endpoint ?? ''}"${opts.endpoint ? '' : ' data-picker-disabled'}">
  <h2 id="media-picker-title">Choose an image</h2>
  <form class="media-picker__search" method="get" data-picker-form>
    <span class="palette__ico">${icon('search')}</span>
    <label class="sr-only" for="media-picker-q">Search the media library</label>
    <input type="search" id="media-picker-q" name="q" placeholder="Search by file name…" autocomplete="off">
    <button class="btn ghost small" type="button" data-picker-close>Cancel</button>
  </form>
  <div class="media-picker__body">
    <div class="media-picker__grid" data-picker-grid role="list"></div>
    <p class="sr-only" id="media-picker-status" role="status" aria-live="polite"></p>
  </div>
  <div class="media-picker__foot">
    <label for="media-picker-alt">Alt text for the image you pick</label>
    <input type="text" id="media-picker-alt" maxlength="200" placeholder="Describe the image for screen readers">
    <p class="hint">Setting alt text here saves you a trip to the library. Leave it empty only for decoration.</p>
    <details class="media-picker__upload">
      <summary>Upload a new image</summary>
      <form method="post" action="" enctype="multipart/form-data" data-picker-upload>
        <label for="media-picker-file">Image file</label>
        <input type="file" id="media-picker-file" name="file" accept="image/*" required>
        <label for="media-picker-file-alt">Alt text</label>
        <input type="text" id="media-picker-file-alt" name="alt" maxlength="200">
        <p class="row"><button class="btn small" type="submit">Upload</button> <span class="hint" data-picker-upload-status role="status"></span></p>
      </form>
    </details>
    <p class="row dialog-actions">
      <button class="btn ghost" type="button" data-picker-close>Cancel</button>
      <button class="btn" type="button" data-picker-insert disabled>Use this image</button>
    </p>
  </div>
</dialog>`;
}

/**
 * Client script. `open({ onPick, uploadUrl })` opens the dialog; the caller
 * decides what to do with `{ url, alt, id }`.
 */
export const PICKER_JS = `<script>
(function () {
  'use strict';
  window.amsMediaPicker = function (options) {
    var dialog = document.getElementById('media-picker');
    if (!dialog || dialog.hasAttribute('data-picker-disabled') || typeof dialog.showModal !== 'function') return null;
    var grid = dialog.querySelector('[data-picker-grid]');
    var search = dialog.querySelector('#media-picker-q');
    var altInput = dialog.querySelector('#media-picker-alt');
    var uploadForm = dialog.querySelector('[data-picker-upload]');
    var uploadStatus = dialog.querySelector('[data-picker-upload-status]');
    var insert = dialog.querySelector('[data-picker-insert]');
    var endpoint = dialog.getAttribute('data-endpoint');
    var chosen = null, timer = null, onPick = null;

    function pick(item, button) {
      chosen = item;
      grid.querySelectorAll('[data-picker-item]').forEach(function (el) { el.setAttribute('aria-current', 'false'); });
      button.setAttribute('aria-current', 'true');
      altInput.value = item.alt || '';
      insert.disabled = false;
    }

    function render(items) {
      if (!items.length) {
        grid.innerHTML = '<p class="hint" style="padding:1rem">No images yet. Upload one below, or add images in Media.</p>';
        return;
      }
      grid.innerHTML = items.map(function (item) {
        var alt = (item.alt || '').replace(/"/g, '&quot;');
        return '<button type="button" class="media-picker__item" role="listitem" data-picker-item data-id="' + item.id +
          '" data-url="' + item.url.replace(/"/g, '&quot;') + '" data-alt="' + alt + '" aria-current="false">' +
          '<img src="' + item.url + '" alt="" loading="lazy">' +
          '<span>' + item.filename.replace(/</g, '&lt;') + '</span></button>';
      }).join('');
      grid.querySelectorAll('[data-picker-item]').forEach(function (button) {
        button.addEventListener('click', function () {
          pick({ id: Number(button.dataset.id), url: button.dataset.url, alt: button.dataset.alt, filename: button.textContent }, button);
        });
      });
      chosen = null;
      insert.disabled = true;
    }

    function load(query) {
      if (!endpoint) return;
      fetch(endpoint + (query ? '?q=' + encodeURIComponent(query) : ''), { credentials: 'same-origin' })
        .then(function (res) { return res.ok ? res.json() : { items: [] }; })
        .then(function (data) {
          render(data.items || []);
          var live = document.getElementById('media-picker-status');
          if (live) live.textContent = (data.items || []).length + ' images';
        })
        .catch(function () { render([]); });
    }

    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { load(search.value.trim()); }, 150);
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
    if (uploadForm) {
      uploadForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var body = new FormData(uploadForm);
        if (!body.get('file') || !body.get('file').size) { uploadStatus.textContent = 'Choose a file first.'; return; }
        uploadStatus.textContent = 'Uploading…';
        fetch(options.uploadUrl || uploadForm.action, { method: 'POST', body: body, credentials: 'same-origin' })
          .then(function (res) { return res.json().catch(function () { return {}; }); })
          .then(function (data) {
            if (data && data.ok) {
              uploadStatus.textContent = 'Uploaded.';
              uploadForm.reset();
              load('');
            } else {
              uploadStatus.textContent = (data && data.error) || 'Upload failed.';
            }
          })
          .catch(function () { uploadStatus.textContent = 'Upload failed.'; });
      });
    }

    return {
      open: function (opts) {
        if (!dialog.open) dialog.showModal();
        onPick = (opts && opts.onPick) || null;
        if (opts && opts.uploadUrl) uploadForm.setAttribute('action', opts.uploadUrl);
        altInput.value = '';
        search.value = '';
        load('');
        setTimeout(function () { search.focus(); }, 0);
      },
    };
  };
})();
</script>`;
