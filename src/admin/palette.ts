/**
 * The command palette's client half (⌘K / Ctrl+K).
 *
 * Progressive enhancement, deliberately: the trigger is a link to /search and
 * the dialog is a real GET form, so with JavaScript disabled everything still
 * works. With JavaScript, typing fetches /search?partial=1 (server-rendered,
 * same markup as the results page) and the arrow keys move through the hits.
 *
 * Kept as a string so it ships in the document with no extra request; it is
 * ~3 KB and the whole feature degrades to the plain search page.
 */
export const PALETTE_JS = `<script>
(function () {
  'use strict';
  var dialog = document.getElementById('palette');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  var input = document.getElementById('palette-input');
  var live = dialog.querySelector('[data-palette-live]');
  var commands = dialog.querySelector('[data-palette-commands]');
  var results = document.getElementById('palette-results');
  var timer = null, lastQuery = '', active = -1;

  function open() {
    if (!dialog.open) dialog.showModal();
    input.value = '';
    results.removeAttribute('aria-busy');
    showCommands();
    announce('Command palette open. Type to search.');
    input.focus();
  }
  function close() { if (dialog.open) dialog.close(); }

  function items() {
    return Array.prototype.slice.call(results.querySelectorAll('[data-palette-item]'));
  }
  function setActive(index) {
    var list = items();
    list.forEach(function (el) { el.classList.remove('is-active'); });
    if (!list.length) { active = -1; input.removeAttribute('aria-activedescendant'); return; }
    active = (index + list.length) % list.length;
    var el = list[active];
    if (!el.id) el.id = 'palette-item-' + active;
    el.classList.add('is-active');
    input.setAttribute('aria-activedescendant', el.id);
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  /** Filters the static commands locally, the way a launcher does. */
  function showCommands() {
    commands.hidden = false;
    live.innerHTML = '';
    var q = input.value.trim().toLowerCase();
    commands.querySelectorAll('[data-palette-item]').forEach(function (el) {
      var text = (el.textContent + ' ' + el.getAttribute('data-keys')).toLowerCase();
      el.parentNode.hidden = q.length > 0 && text.indexOf(q) === -1;
    });
    // Hide a group whose every item is hidden.
    commands.querySelectorAll('.search-group').forEach(function (group) {
      var shown = group.querySelectorAll('li:not([hidden])').length;
      group.hidden = shown === 0;
    });
    active = -1;
  }

  function showResults(html) {
    commands.hidden = true;
    if (!html) {
      // Dropped request or a server hiccup: say so instead of showing nothing.
      live.innerHTML = '<div class="search-empty" role="status">Search is not answering. Press Enter to open the full search page.</div>';
      active = -1;
      return;
    }
    live.innerHTML = html;
    active = -1;
    setActive(0);
    var count = items().length;
    announce(count ? count + (count === 1 ? ' result' : ' results') + ' for ' + lastQuery : 'No results for ' + lastQuery);
  }

  function announce(text) {
    var region = document.getElementById('palette-status');
    if (region) region.textContent = text;
  }

  function search(q) {
    lastQuery = q;
    var url = dialog.getAttribute('data-search-url');
    if (!url) return;
    fetch(url + '?q=' + encodeURIComponent(q) + '&partial=1', { credentials: 'same-origin', headers: { 'x-requested-with': 'palette' } })
      .then(function (res) { return res.ok ? res.text() : ''; })
      .then(function (html) {
      if (q !== lastQuery) return;
      results.removeAttribute('aria-busy');
      showResults(html);
    })
      .catch(function () { /* the form still submits to /search */ });
  }

  input.addEventListener('input', function () {
    var q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { showCommands(); announce(''); return; }
    // Say "searching" once, not on every keystroke, so the live region stays quiet.
    if (!/\.\.\.$/.test(live.textContent || '')) announce('Searching…');
    results.setAttribute('aria-busy', 'true');
    timer = setTimeout(function () { search(q); }, 120);
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(active + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(active - 1); }
    else if (event.key === 'Enter') {
      if (active === -1) return; // plain Enter submits the form to /search
      var el = items()[active];
      if (el) { event.preventDefault(); window.location.href = el.href; }
    }
  });

  dialog.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) close(); // click on the backdrop
  });
  dialog.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('[data-palette-close]')) { event.preventDefault(); close(); }
  });

  document.querySelectorAll('[data-palette-open]').forEach(function (el) {
    el.addEventListener('click', function (event) { event.preventDefault(); open(); });
  });

  // ⌘K / Ctrl+K from anywhere; "/" when not already typing.
  document.addEventListener('keydown', function (event) {
    var typing = /^(input|textarea|select)$/i.test(event.target.tagName) || event.target.isContentEditable;
    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      dialog.open ? close() : open();
      return;
    }
    if (event.key === '/' && !typing) { event.preventDefault(); open(); }
  });
})();
</script>`;

/** Wires the palette to its search endpoint; called by layout(). */
export const paletteConfig = (searchUrl: string): string =>
  `<script>document.getElementById('palette').setAttribute('data-search-url', ${JSON.stringify(searchUrl)});</script>`;
