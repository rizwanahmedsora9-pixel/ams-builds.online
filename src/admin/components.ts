/**
 * Admin component kit.
 *
 * Every screen is built from these instead of hand-written markup, so a change
 * to a page header, a table or an empty state happens once. All of them render
 * `html` tagged templates (escaped by default) and all of them work without
 * JavaScript.
 *
 * Rule of thumb when adding a screen:
 *   pageHead(...) → tabs/nav → card(...) or table(...) → emptyState(...) if the
 *   list can be empty. No raw <table>/<h1> in a route.
 */
import type { Raw } from '../lib/ui';
import { csrfField, html, raw } from '../lib/ui';
import type { Ctx } from '../types';
import { icon } from './icons';

export type Child = unknown;

/* ---------------------------------------------------------------- page head */

export type Crumb = { label: string; href?: string };

/**
 * Page header: optional breadcrumbs, title, subtitle, actions, and an optional
 * tab strip. `actions` is a list of nodes (usually buttons or small forms).
 */
export function pageHead(opts: {
  title: string;
  sub?: Child;
  crumbs?: Crumb[];
  actions?: Child;
  id?: string;
}): Raw {
  const { title, sub, crumbs, actions, id } = opts;
  return html`${crumbs?.length ? breadcrumbs(crumbs) : ''}
<div class="page-head">
  <div class="page-head__text">
    <h1${id ? raw(` id="${id}"`) : ''}>${title}</h1>
    ${sub ? html`<p class="page-head__sub">${sub}</p>` : ''}
  </div>
  ${actions ? html`<div class="page-head__actions">${actions}</div>` : ''}
</div>`;
}

export function breadcrumbs(items: Crumb[]): Raw {
  return html`<nav aria-label="Breadcrumb"><ol class="crumbs">
  ${items.map((item, i) => {
    const last = i === items.length - 1;
    return html`<li>${item.href && !last
      ? html`<a href="${item.href}">${item.label}</a>`
      : html`<span${last ? raw(' aria-current="page"') : ''}>${item.label}</span>`}</li>`;
  })}
</ol></nav>`;
}

/** Tab strip. Each tab is a link (no JS needed); the current one gets aria-current. */
export function tabs(items: { label: Child; href: string; current?: boolean }[], opts: { label?: string } = {}): Raw {
  return html`<nav class="tabs"${opts.label ? raw(` aria-label="${opts.label}"`) : raw('')}>
  ${items.map((t) => html`<a href="${t.href}"${t.current ? raw(' aria-current="page"') : raw('')}>${t.label}</a>`)}
</nav>`;
}

/* -------------------------------------------------------------------- cards */

export function card(opts: { title?: Child; head?: Child; actions?: Child; body: Child; id?: string; cls?: string; flush?: boolean }): Raw {
  const cls = ['card', opts.flush ? 'card--flush' : '', opts.cls || ''].filter(Boolean).join(' ');
  return html`<section class="${cls}"${opts.id ? raw(` id="${opts.id}"`) : raw('')}>
  ${opts.title || opts.head || opts.actions
    ? html`<div class="card__head">${opts.title ? html`<h2>${opts.title}</h2>` : ''}${opts.head || ''}${opts.actions || ''}</div>`
    : ''}
  ${opts.body}
</section>`;
}

/* ------------------------------------------------------------------- tables */

export type Column = {
  label: Child;
  /** Extra class on <th> and every <td> in this column. */
  cls?: string;
  /** Present on sortable columns: where clicking the header leads. */
  sortHref?: string;
  /** Whether this column is the active sort, and in which direction. */
  sortState?: 'asc' | 'desc';
  align?: 'center' | 'right';
};

/**
 * Responsive table. Wrapped in a scroll container, with a monospace-free
 * thead and row hover. Cells are rendered by the caller so each screen keeps
 * control of its own content.
 */
export function table(opts: { columns: Column[]; rows: Child[][]; cls?: string; caption?: string; wrapClass?: string }): Raw {
  const align = (c: Column) => (c.align === 'center' ? ' style="text-align:center"' : c.align === 'right' ? ' style="text-align:right"' : '');
  const head = (c: Column) => {
    if (!c.sortHref) return html`<th scope="col"${c.cls ? raw(` class="${c.cls}"`) : raw('')}${raw(align(c))}>${c.label}</th>`;
    const aria = c.sortState ? (c.sortState === 'asc' ? 'ascending' : 'descending') : 'none';
    const arrow = c.sortState ? (c.sortState === 'asc' ? '↑' : '↓') : '↕';
    return html`<th scope="col"${c.cls ? raw(` class="${c.cls}"`) : raw('')}${raw(` aria-sort="${aria}"`)}>
      <a class="th-sort${c.sortState ? ' is-active' : ''}" href="${c.sortHref}">${c.label}<span class="th-sort__arrow" aria-hidden="true">${arrow}</span></a>
    </th>`;
  };
  return html`<div class="table-wrap${opts.wrapClass ? ' ' + opts.wrapClass : ''}">
  <table class="table${opts.cls ? ' ' + opts.cls : ''}"${opts.caption ? raw(` aria-label="${opts.caption}"`) : raw('')}>
    <thead><tr>${opts.columns.map(head)}</tr></thead>
    <tbody>
      ${opts.rows.map((cells) => html`<tr>${cells.map((cell, i) => {
        const col = opts.columns[i];
        const label = typeof col?.label === 'string' ? col.label : '';
        return html`<td${col?.cls ? raw(` class="${col.cls}"`) : raw('')}${raw(align(col))}${label ? raw(` data-label="${label}"`) : raw('')}>${cell}</td>`;
      })}</tr>`)}
    </tbody>
  </table>
</div>`;
}

/* -------------------------------------------------------------- empty state */

export function emptyState(opts: { title: string; body?: Child; action?: Child; iconName?: string }): Raw {
  return html`<div class="empty">
  <span class="empty__ico">${icon(opts.iconName || 'file')}</span>
  <strong>${opts.title}</strong>
  ${opts.body ? html`<p>${opts.body}</p>` : ''}
  ${opts.action || ''}
</div>`;
}

/* ------------------------------------------------------------------ notices */

export function notice(body: Child, opts: { tone?: 'info' | 'warn' | 'danger'; title?: Child } = {}): Raw {
  const tone = opts.tone || 'info';
  const iconName = tone === 'danger' ? 'alert' : tone === 'warn' ? 'alert' : 'info';
  return html`<div class="notice${tone === 'info' ? '' : ' ' + tone}" role="${tone === 'danger' ? 'alert' : 'status'}">
  ${icon(iconName)}<div>${opts.title ? html`<b>${opts.title}</b> ` : ''}${body}</div>
</div>`;
}

/* -------------------------------------------------------------- pagination */

export function pagination(opts: { prev?: string; next?: string; info?: Child; prevLabel?: string; nextLabel?: string }): Raw {
  return html`<div class="pagination">
  <div>${opts.prev ? html`<a class="btn ghost small" href="${opts.prev}">${icon('chevron-left', { cls: 'ico--sm' })}${opts.prevLabel || 'Previous'}</a>` : ''}</div>
  ${opts.info ? html`<span class="pagination__info">${opts.info}</span>` : ''}
  <div>${opts.next ? html`<a class="btn ghost small" href="${opts.next}">${opts.nextLabel || 'Next'}${icon('chevron-right', { cls: 'ico--sm' })}</a>` : ''}</div>
</div>`;
}

/* ------------------------------------------------------------------ buttons */

/** A POST button with the CSRF token and an optional confirm prompt. */
export function postButton(c: Ctx, action: string, label: Child, opts: { cls?: string; confirm?: string; name?: string; value?: string; title?: string } = {}): Raw {
  return html`<form method="post" action="${action}" class="inline"${opts.confirm ? raw(` data-confirm="${opts.confirm.replace(/"/g, '&quot;')}"`) : raw('')}>
  ${csrfField(c)}
  ${opts.name ? html`<input type="hidden" name="${opts.name}" value="${opts.value ?? ''}">` : ''}
  <button class="btn ${opts.cls || 'ghost small'}" type="submit"${opts.title ? raw(` title="${opts.title}"`) : raw('')}>${label}</button>
</form>`;
}

/* ------------------------------------------------------------------ dialogs */

export function dialog(opts: { id: string; title: Child; body: Child; actions?: Child }): Raw {
  return html`<dialog id="${opts.id}" aria-labelledby="${opts.id}-title">
  <h2 id="${opts.id}-title">${opts.title}</h2>
  ${opts.body}
  ${opts.actions ? html`<div class="dialog-actions">${opts.actions}</div>` : ''}
</dialog>`;
}

/* ------------------------------------------------------------------- fields */

export function field(opts: { name: string; label: Child; value?: string; type?: string; hint?: Child; required?: boolean; maxlength?: number; placeholder?: string; attrs?: string }): Raw {
  const type = opts.type || 'text';
  return html`<label for="${opts.name}">${opts.label}</label>
<input type="${type}" id="${opts.name}" name="${opts.name}" value="${opts.value ?? ''}"${opts.required ? raw(' required') : raw('')}${opts.maxlength ? raw(` maxlength="${opts.maxlength}"`) : raw('')}${opts.placeholder ? raw(` placeholder="${opts.placeholder}"`) : raw('')}${opts.attrs ? raw(' ' + opts.attrs) : raw('')}>
${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ''}`;
}

export function selectField(opts: { name: string; label: Child; options: { value: string; label: string }[]; value?: string; hint?: Child; required?: boolean }): Raw {
  return html`<label for="${opts.name}">${opts.label}</label>
<select id="${opts.name}" name="${opts.name}"${opts.required ? raw(' required') : raw('')}>
  ${opts.options.map((o) => html`<option value="${o.value}"${o.value === opts.value ? raw(' selected') : raw('')}>${o.label}</option>`)}
</select>
${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ''}`;
}

/* --------------------------------------------------------------- js helpers */

/**
 * The panel's only shared client script: confirm prompts for [data-confirm],
 * dismissing toasts, and keeping duplicate bulk-action selects in sync.
 * Screens may add their own <script>; nothing here is required for the page to
 * work.
 */
export const APP_JS = `<script>
(function () {
  'use strict';

  // Destructive actions ask first.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.getAttribute) return;
    var message = form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) { event.preventDefault(); return; }
    if (form.hasAttribute('data-busy')) {
      var button = form.querySelector('button[type=submit]');
      if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    }
  });

  // Toasts: dismiss on click, auto-close after 6s, pause while hovered.
  document.querySelectorAll('[data-toast]').forEach(function (toast) {
    var timer;
    function close() { toast.remove(); }
    function schedule() { timer = setTimeout(close, 6000); }
    toast.addEventListener('click', close);
    toast.addEventListener('mouseenter', function () { clearTimeout(timer); });
    toast.addEventListener('mouseleave', schedule);
    schedule();
  });

  // Close the user menu when clicking elsewhere.
  document.addEventListener('click', function (event) {
    document.querySelectorAll('details.usermenu[open]').forEach(function (menu) {
      if (!menu.contains(event.target)) menu.removeAttribute('open');
    });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('details.usermenu[open]').forEach(function (menu) { menu.removeAttribute('open'); });
  });

  // The sidebar remembers its collapsed state in a cookie so the server can
  // render the right width on the next request (no layout jump on load).
  var railBox = document.getElementById('side-c');
  if (railBox) {
    railBox.addEventListener('change', function () {
      document.cookie = 'ams_rail=' + (railBox.checked ? '1' : '0') + '; path=/; max-age=31536000; samesite=lax';
    });
  }
})();
</script>`;

/* -------------------------------------------------------------- list screens */

/**
 * Sortable column header. The default direction depends on the column: titles
 * read A→Z first, dates read newest first.
 */
/** A sortable column definition, for screens that build columns in a loop. */
export function sortColumn(opts: {
  label: Child; href: string; active: boolean; dir: 'asc' | 'desc'; cls?: string;
}): Column {
  return { label: opts.label, sortHref: opts.href, sortState: opts.active ? opts.dir : undefined, cls: opts.cls };
}

/**
 * The bar above a list: status tabs, search box, filters and the bulk actions.
 * Everything is a plain GET form, so the state lives in the URL and a filtered
 * list can be bookmarked or shared.
 */
export function listToolbar(opts: {
  tabs?: Child;
  search: { action: string; name?: string; value: string; placeholder: string; label: string; button?: string; hidden?: Record<string, string> };
  filters?: Child;
  actions?: Child;
}): Raw {
  const { search } = opts;
  // Two sibling forms, never nested: a browser drops a form inside a form, which
  // would silently disconnect the filter selects from their submit button.
  return html`${opts.tabs ? html`<div class="list-toolbar__tabs">${opts.tabs}</div>` : ''}
<div class="list-toolbar">
  <form class="list-toolbar__search" method="get" action="${search.action}" role="search">
    ${icon('search', { cls: 'ico--sm' })}
    ${Object.entries(search.hidden || {}).filter(([, v]) => v).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
    <label class="sr-only" for="list-q">${search.label}</label>
    <input type="search" id="list-q" name="${search.name || 'q'}" value="${search.value}" placeholder="${search.placeholder}" maxlength="120">
    <button class="btn small" type="submit">${search.button || 'Search'}</button>
  </form>
  ${opts.filters ? html`<div class="list-toolbar__filters">${opts.filters}</div>` : ''}
  ${opts.actions ? html`<div class="list-toolbar__actions">${opts.actions}</div>` : ''}
</div>`;
}

/**
 * Bulk actions. One select, one Apply button, kept in sync with the copy at the
 * bottom of the table; the bar only appears when something is selected
 * (CSS-driven, no JavaScript needed for it to work).
 */
export function bulkBar(opts: { formId: string; id: string; count: number }): Raw {
  return html`<div class="bulk-bar" id="${opts.id}" aria-live="polite">
  <span class="bulk-bar__count"><b data-bulk-count>0</b> of ${opts.count} selected</span>
  <label class="sr-only" for="${opts.id}-action">Bulk action</label>
  <select id="${opts.id}-action" name="action" form="${opts.formId}">
    <option value="">Bulk actions</option>
    <option value="publish">Publish</option>
    <option value="draft">Move to draft</option>
    <option value="delete">Delete permanently</option>
  </select>
  <button class="btn small" type="submit" form="${opts.formId}">Apply</button>
</div>`;
}

/**
 * A row that collapses into a card on a narrow screen: the table keeps its
 * columns on desktop, and each cell carries a label so the 360 px layout still
 * reads as a list instead of a sideways scroll.
 */
export function td(label: string, value: Child, opts: { cls?: string; align?: 'center' } = {}): Raw {
  return html`<td${opts.cls ? raw(` class="${opts.cls}"`) : raw('')}${opts.align === 'center' ? raw(' style="text-align:center"') : raw('')} data-label="${label}">${value}</td>`;
}

/** An empty row that spans a whole table and explains what to do next. */
export function emptyRow(colspan: number, opts: { title: string; body?: Child; action?: Child }): Raw {
  return html`<tr><td colspan="${colspan}" class="table-empty">
  ${emptyState({ title: opts.title, body: opts.body, action: opts.action, iconName: 'search' })}
</td></tr>`;
}

/**
 * Client behaviour for list screens: select-all, the live count, keeping the two
 * bulk selects in sync, and reflecting the selection on the toolbar. Without
 * JavaScript the checkboxes, the selects and the forms still submit.
 */
export const LIST_JS = `<script>
(function () {
  'use strict';
  document.querySelectorAll('[data-list]').forEach(function (root) {
    var form = document.getElementById(root.getAttribute('data-list'));
    if (!form) return;
    var boxes = Array.prototype.slice.call(root.querySelectorAll('input[name="ids"]'));
    var all = root.querySelector('[data-select-all]');
    var count = root.querySelector('[data-bulk-count]');
    var bar = root.querySelector('.bulk-bar');

    function update() {
      var checked = boxes.filter(function (box) { return box.checked; });
      if (all) {
        all.checked = boxes.length > 0 && checked.length === boxes.length;
        all.indeterminate = checked.length > 0 && checked.length < boxes.length;
      }
      if (count) count.textContent = String(checked.length);
      if (bar) bar.classList.toggle('is-active', checked.length > 0);
      root.classList.toggle('has-selection', checked.length > 0);
    }

    if (all) all.addEventListener('change', function () {
      boxes.forEach(function (box) { box.checked = all.checked; });
      update();
    });
    boxes.forEach(function (box) { box.addEventListener('change', update); });

    // Row click selects nothing; the title link and the checkbox stay targets.
    form.addEventListener('submit', function (event) {
      var select = form.querySelector('select[name="action"]');
      if (!select) return;
      var chosen = select.value;
      var message = chosen === 'delete'
        ? 'Permanently delete the selected items? This cannot be undone.'
        : !chosen ? 'Choose a bulk action first.' : '';
      if (!message) return;
      if (chosen === 'delete' && !window.confirm(message)) { event.preventDefault(); return; }
      if (!chosen) { event.preventDefault(); window.alert(message); }
    });

    update();
  });
})();
</script>`;
