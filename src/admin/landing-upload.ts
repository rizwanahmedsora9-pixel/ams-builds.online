/**
 * The panel script behind Settings -> Landing screen.
 *
 * Soundtrack files are the one upload in the panel that people actually hit
 * limits with: a 6 MB MP3 in a multipart POST, together with every other
 * setting, is the request a mobile network drops half way through. When it
 * drops, the browser shows its own error page and none of the settings are
 * saved — which is what "it says offline and nothing saves" looks like.
 *
 * So the page posts one file per request: each file either lands (and shows a
 * progress row) or fails on its own with a message that says what to do. The
 * remaining fields are saved once, separately, and only after that. Without
 * JavaScript the form still works as one ordinary submit; the server accepts
 * both.
 */

export const LANDING_UPLOAD_JS = `<script>
(function () {
  'use strict';
  var form = document.getElementById('settings-form');
  if (!form || !window.fetch || !window.FormData) return;
  var picker = document.getElementById('landing_audio_files');
  var queue = document.getElementById('landing-upload-queue');
  var note = document.getElementById('landing-upload-note');
  var saveButton = form.querySelector('button[type=submit]');
  var MAX = 20 * 1024 * 1024;
  var AUDIO = /\\.(mp3|ogg|opus|wav|m4a|aac|flac)$/i;
  var ENDPOINT = form.getAttribute('data-upload-endpoint') || '';
  if (!picker || !queue || !ENDPOINT) return;

  function size(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }
  function say(text, isError) {
    if (!note) return;
    note.textContent = text;
    note.className = isError ? 'hint landing-upload-note is-error' : 'hint landing-upload-note';
  }
  function row(file) {
    var item = document.createElement('div');
    item.className = 'landing-upload-row';
    item.innerHTML = '<span class="landing-upload-name"></span><span class="landing-upload-state" role="status"></span>';
    item.querySelector('.landing-upload-name').textContent = file.name + ' · ' + size(file.size);
    item.querySelector('.landing-upload-state').textContent = 'Waiting…';
    queue.appendChild(item);
    queue.hidden = false;
    return item;
  }

  /** One file, one request: a dropped connection costs that file only. */
  function uploadOne(file) {
    var item = row(file);
    var state = item.querySelector('.landing-upload-state');
    var body = new FormData();
    var token = form.querySelector('input[name=_csrf]');
    if (token) body.set('_csrf', token.value);
    body.set('audio', file, file.name);
    state.textContent = 'Uploading…';
    return fetch(ENDPOINT, { method: 'POST', body: body, credentials: 'same-origin' })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.ok && data && data.ok) {
            state.textContent = 'Saved';
            item.classList.add('is-done');
            return data;
          }
          throw new Error((data && data.error) || 'the server refused this file (' + res.status + ')');
        });
      })
      .catch(function (error) {
        state.textContent = 'Could not save — ' + (error && error.message ? error.message : 'check your connection');
        item.classList.add('is-error');
        return null;
      });
  }

  function uploadAll(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return Promise.resolve(true);
    var usable = [];
    var refused = 0;
    list.forEach(function (file) {
      if (!AUDIO.test(file.name)) { refused++; say('"' + file.name + '" is not an audio file. Use MP3, OGG, WAV, M4A, AAC, FLAC or Opus.', true); return; }
      if (file.size > MAX) { refused++; say('"' + file.name + '" is ' + size(file.size) + '; the limit is 20 MB per track.', true); return; }
      usable.push(file);
    });
    if (!usable.length) return Promise.resolve(refused === 0);
    if (saveButton) saveButton.disabled = true;
    say('Uploading ' + usable.length + (usable.length === 1 ? ' track…' : ' tracks…'), false);
    var done = 0, failed = 0;
    return usable.reduce(function (chain, file) {
      return chain.then(function () {
        return uploadOne(file).then(function (result) {
          if (result) done++; else failed++;
          say('Uploading ' + (done + failed) + ' of ' + usable.length + '…', false);
          return result;
        });
      });
    }, Promise.resolve()).then(function () {
      if (saveButton) saveButton.disabled = false;
      say(done + (done === 1 ? ' track saved.' : ' tracks saved.') +
        (failed ? ' ' + failed + ' could not be saved — try again, one at a time.' : ''), failed > 0);
      return failed === 0;
    });
  }

  picker.addEventListener('change', function () {
    if (!picker.files || !picker.files.length) return;
    uploadAll(picker.files).then(function () {
      // The files are already in the library; the picker holds nothing.
      try { picker.value = ''; } catch (e) {}
      if (queue && queue.children.length) {
        var last = queue.lastElementChild;
        if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' });
      }
    });
  });

  form.addEventListener('submit', function (event) {
    var pending = picker.files && picker.files.length;
    if (!pending) return;
    event.preventDefault();
    say('Wait for the soundtrack files to finish uploading, then save again.', true);
  });
})();
</script>`;
