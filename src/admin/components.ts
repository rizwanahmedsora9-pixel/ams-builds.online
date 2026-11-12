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
  /** Renders the aria-sort attribute for sortable columns. */
  sort?: 'ascending' | 'descending' | 'none';
  align?: 'center' | 'right';
};

/**
 * Responsive table. Wrapped in a scroll container, with a monospace-free
 * thead and row hover. Cells are rendered by the caller so each screen keeps
 * control of its own content.
 */
export function table(opts: { columns: Column[]; rows: Child[][]; cls?: string; caption?: string; wrapClass?: string }): Raw {
  const align = (c: Column) => (c.align === 'center' ? ' style="text-align:center"' : c.align === 'right' ? ' style="text-align:right"' : '');
  return html`<div class="table-wrap${opts.wrapClass ? ' ' + opts.wrapClass : ''}">
  <table class="table${opts.cls ? ' ' + opts.cls : ''}"${opts.caption ? raw(` aria-label="${opts.caption}"`) : raw('')}>
    <thead><tr>
      ${opts.columns.map((c) => html`<th scope="col"${c.cls ? raw(` class="${c.cls}"`) : raw('')}${c.sort ? raw(` aria-sort="${c.sort}"`) : raw('')}${raw(align(c))}>${c.label}</th>`)}
    </tr></thead>
    <tbody>
      ${opts.rows.map((cells) => html`<tr>${cells.map((cell, i) => html`<td${opts.columns[i]?.cls ? raw(` class="${opts.columns[i].cls}"`) : raw('')}${raw(align(opts.columns[i]))}>${cell}</td>`)}</tr>`)}
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
