// AMS Builds admin — vanilla JS single-page app served from /admin/.
// Talks to /admin/api/* with the CSRF header; no frameworks, no build step
// beyond Vite bundling this module into the page.
import { CONTENT_FIELDS, SETTINGS_SECTIONS, defaultData, suggestSlug, validateEntry, validateSettings } from './fields.mjs';

const API_HEADER = { 'x-requested-with': 'ams-admin' };

const state = {
  status: null,
  editor: null,
  dirty: false,
};

// ── tiny helpers ────────────────────────────────────────────────────────
function $(selector, root = document) {
  return root.querySelector(selector);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message, kind = 'ok') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.className =
    kind === 'ok'
      ? 'fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-xl border border-emerald-500/30 bg-emerald-950 text-emerald-200'
      : 'fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-xl border border-rose-500/30 bg-rose-950 text-rose-200';
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3800);
}

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = { ...API_HEADER };
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  if (res.status === 401 && !raw) {
    location.reload();
    throw new Error('Session expired');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = new Error((data && data.error) || `Request failed (${res.status})`);
    error.data = data;
    error.status = res.status;
    throw error;
  }
  return data;
}

function openModal(html, handler) {
  const modal = $('#modal');
  modal.innerHTML = html;
  modal.classList.remove('hidden');
  modal.onclick = (event) => {
    if (event.target === modal) return closeModal();
    if (handler) handler(event);
  };
}

function closeModal() {
  const modal = $('#modal');
  modal.classList.add('hidden');
  modal.innerHTML = '';
  modal.onclick = null;
}

window.addEventListener('beforeunload', (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ── router ──────────────────────────────────────────────────────────────
function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  if (!parts.length) return { view: 'dashboard' };
  if (parts[0] === 'edit' && parts[1] && parts[2]) {
    return { view: 'edit', type: parts[1], slug: decodeURIComponent(parts[2]) };
  }
  if (parts[0] === 'new' && parts[1]) return { view: 'edit', type: parts[1], slug: null };
  return { view: parts[0] };
}

async function route() {
  const target = parseHash();
  state.dirty = false;
  state.editor = null;
  setActiveNav(target.view === 'edit' ? target.type : target.view);
  const view = $('#view');
  if (!view) return;
  try {
    if (target.view === 'dashboard') await renderDashboard(view);
    else if (['blog', 'pages', 'projects'].includes(target.view)) await renderList(view, target.view);
    else if (target.view === 'edit') await renderEditor(view, target.type, target.slug);
    else if (target.view === 'settings') await renderSettings(view);
    else if (target.view === 'media') await renderMedia(view);
    else if (target.view === 'export' || target.view === 'publish') await renderExport(view);
    else if (target.view === 'account') await renderAccount(view);
    else await renderDashboard(view);
  } catch (error) {
    view.innerHTML = `<div class="card p-6 text-rose-300 text-sm">${esc(error.message)}</div>`;
  }
}

function setActiveNav(name) {
  if (name === 'publish') name = 'export';
  document.querySelectorAll('#admin-nav .nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === name);
  });
}

function loadStatus() {
  return api('/admin/api/status');
}

// ── views ───────────────────────────────────────────────────────────────
async function renderDashboard(view) {
  const status = await loadStatus();
  state.status = status;
  view.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">Dashboard</h1>
        <p class="text-sm text-slate-400 mt-1">Signed in as <strong class="text-slate-200">${esc(status.user)}</strong> · ${status.store === 'dev' ? 'shared local dev files' : 'shared Cloudflare storage'}</p>
      </div>
      <span class="badge bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Live for every visitor</span>
    </div>
    <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
      ${countCard('Blog posts', status.counts.blog, '#/blog')}
      ${countCard('Pages', status.counts.pages, '#/pages')}
      ${countCard('Projects', status.counts.projects, '#/projects')}
      ${countCard('Images', status.mediaCount, '#/media')}
    </div>
    <div class="grid sm:grid-cols-2 gap-4 mt-6">
      <div class="card p-5">
        <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400">Quick actions</h2>
        <div class="flex flex-wrap gap-2 mt-3">
          <a class="btn btn-primary" href="#/new/blog">+ New blog post</a>
          <a class="btn btn-ghost" href="#/new/pages">+ New page</a>
          <a class="btn btn-ghost" href="#/new/projects">+ New project</a>
          <a class="btn btn-ghost" href="#/settings">Site settings</a>
        </div>
      </div>
      <div class="card p-5">
        <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400">Instant publishing</h2>
        <p class="text-sm text-slate-300 mt-2 leading-6">Save any page, post, project, photo or setting and it is served on the next request. No Publish button, rebuild, GitHub login or browser-local copy is needed.</p>
        <div class="flex flex-wrap gap-2 mt-3">
          <a href="/" target="_blank" rel="noopener" class="btn btn-ghost text-xs">Open live site ↗</a>
          <a href="#/export" class="btn btn-ghost text-xs">Export backup</a>
        </div>
      </div>
    </div>
  `;
}

function countCard(label, value, href) {
  return `
    <a href="${href}" class="card p-5 block hover:border-amber-500/40 transition">
      <p class="text-3xl font-extrabold text-white">${Number(value) || 0}</p>
      <p class="text-sm text-slate-400 mt-1">${esc(label)}</p>
    </a>
  `;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

const TYPE_LABELS = { blog: 'Blog posts', pages: 'Pages', projects: 'Projects' };
const TYPE_NEW = { blog: 'New blog post', pages: 'New page', projects: 'New project' };
const SLUG_PREFIX = { blog: '/blog/', pages: '/', projects: '/projects/' };

async function renderList(view, type) {
  const data = await api(`/admin/api/content?type=${type}`);
  const items = data.items || [];
  const rows = items
    .map((item) => {
      const title = item.data?.title || item.slug;
      const date = item.data?.pubDate || item.data?.date || '';
      const draft = item.data?.draft ? `<span class="badge bg-slate-700 text-slate-300">draft</span>` : '';
      const source =
        item.source === 'cms' ? `<span class="badge bg-amber-500/10 text-amber-300 border border-amber-500/25">edited</span>` : '';
      const when = date ? `<span class="text-xs text-slate-500">${esc(date)}</span>` : '';
      const prefix = type === 'pages' ? '' : `${type}/`;
      return `
        <tr class="table-row">
          <td class="py-3 pr-3">
            <a href="#/edit/${type}/${encodeURIComponent(item.slug)}" class="font-semibold text-white hover:text-amber-400">${esc(title)}</a>
            <div class="text-xs text-slate-500 mt-0.5">/${prefix}${esc(item.slug)}/ ${draft} ${source}</div>
          </td>
          <td class="py-3 pr-3 text-right whitespace-nowrap">${when}</td>
          <td class="py-3 text-right whitespace-nowrap">
            <a class="text-xs font-bold text-amber-400 hover:text-amber-300" href="#/edit/${type}/${encodeURIComponent(item.slug)}">Edit</a>
          </td>
        </tr>`;
    })
    .join('');

  view.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <h1 class="text-2xl font-extrabold tracking-tight">${esc(TYPE_LABELS[type])}</h1>
      <div class="flex gap-2">
        <a class="btn btn-primary" href="#/new/${type}">+ New</a>
        <a class="btn btn-ghost" href="${SLUG_PREFIX[type]}" target="_blank" rel="noopener">View on site ↗</a>
      </div>
    </div>
    <div class="card mt-5 overflow-hidden">
      ${
        items.length
          ? `<table class="w-full text-sm"><tbody>${rows}</tbody></table>`
          : `<p class="p-8 text-center text-slate-500">Nothing here yet. Create the first one.</p>`
      }
    </div>
  `;
}

// ── editor ──────────────────────────────────────────────────────────────
function fieldHtml(field, value) {
  const id = `f-${field.name}`;
  const label = `<label class="field-label" for="${id}">${esc(field.label)}${field.required ? ' *' : ''}</label>`;
  const hint = field.hint ? `<p class="field-hint">${esc(field.hint)}</p>` : '';
  const val = value === undefined || value === null ? '' : value;

  if (field.type === 'checkbox') {
    return `
      <div class="flex items-center gap-2.5 py-1">
        <input type="checkbox" id="${id}" data-field="${field.name}" ${val ? 'checked' : ''} class="w-4 h-4 rounded accent-amber-500" />
        <label for="${id}" class="text-sm text-slate-300 select-none">${esc(field.label)}</label>
      </div>`;
  }
  if (field.type === 'textarea') {
    return `<div>${label}<textarea id="${id}" data-field="${field.name}" rows="3" class="field-input" placeholder="${esc(field.placeholder || '')}">${esc(val)}</textarea>${hint}</div>`;
  }
  if (field.type === 'select') {
    const options = (field.options || [])
      .map((opt) => `<option value="${esc(opt.value)}" ${val === opt.value ? 'selected' : ''}>${esc(opt.label)}</option>`)
      .join('');
    return `<div>${label}<select id="${id}" data-field="${field.name}" class="field-input">${options}</select>${hint}</div>`;
  }
  if (field.type === 'list') {
    const text = Array.isArray(val) ? val.join('\n') : String(val || '');
    const rows = text.split('\n').filter((line) => line.trim() !== '').length;
    return `<div>${label}<textarea id="${id}" data-field="${field.name}" data-kind="list" data-split="${field.name === 'results' ? 'line' : 'comma'}" rows="${Math.max(2, rows)}" class="field-input" placeholder="${esc(field.placeholder || '')}">${esc(text)}</textarea>${hint}</div>`;
  }
  if (field.type === 'pairs') {
    const pairs = Array.isArray(val) ? val : [];
    const rowsHtml = pairs
      .map(
        (pair) => `
        <div class="flex gap-2 items-center pair-row">
          <input class="field-input pair-value" placeholder="Value (e.g. 120+)" value="${esc(pair.value)}" />
          <input class="field-input pair-label" placeholder="Label (e.g. Projects delivered)" value="${esc(pair.label)}" />
          <button type="button" class="btn btn-danger pair-remove" title="Remove">×</button>
        </div>`,
      )
      .join('');
    return `
      <div data-field-wrap="${field.name}" data-kind="pairs" class="sm:col-span-2">
        ${label}
        <div class="space-y-2 pairs">${rowsHtml}</div>
        <button type="button" class="btn btn-ghost pair-add mt-2">+ Add row</button>
        ${hint}
      </div>`;
  }
  const inputType = { date: 'date', number: 'number', url: 'url', email: 'email' }[field.type] || 'text';
  const input = `<input type="${inputType}" id="${id}" data-field="${field.name}" class="field-input" value="${esc(val)}" placeholder="${esc(field.placeholder || '')}" />`;
  if (field.type === 'media') {
    return `<div>${label}<div class="flex gap-2">${input}<button type="button" class="btn btn-ghost shrink-0" data-picker-for="${id}">Choose</button></div>${hint}</div>`;
  }
  return `<div>${label}${input}${hint}</div>`;
}

async function renderEditor(view, type, slug) {
  if (type === 'settings') return renderSettings(view);

  const fields = CONTENT_FIELDS[type];
  if (!fields) {
    view.innerHTML = `<div class="card p-6 text-rose-300">Unknown content type.</div>`;
    return;
  }

  let entry;
  if (slug) {
    entry = (await api(`/admin/api/entry?type=${type}&slug=${encodeURIComponent(slug)}`)).entry;
  } else {
    entry = { type, slug: null, data: defaultData(type), body: '', source: 'new', updated_at: null };
  }
  state.editor = { type, slug: entry.slug, data: { ...entry.data }, body: entry.body || '', source: entry.source };

  const title = entry.data.title || (slug ? slug : TYPE_NEW[type]);
  const previewUrl = slug && entry.data.draft !== true ? `${SLUG_PREFIX[type]}${slug}/` : null;
  const leadFields = ['title', 'description', 'heroTitle', 'heroSubtitle'];

  view.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <a href="#/${type}" class="text-xs text-slate-500 hover:text-slate-300">← ${esc(TYPE_LABELS[type])}</a>
        <h1 class="text-2xl font-extrabold tracking-tight truncate">${slug ? 'Edit' : 'Create'}: ${esc(title)}</h1>
        <p class="text-xs text-slate-500 mt-1">
          ${entry.source === 'file' ? 'From the repository (saving stores a CMS copy)' : entry.source === 'cms' ? `Saved in the CMS · ${esc(fmtDate(entry.updated_at))}` : 'New entry'}
          ${entry.data.draft ? '<span class="badge bg-slate-700 text-slate-300 ml-1">draft</span>' : ''}
        </p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button id="btn-save" class="btn btn-primary">Save</button>
        ${previewUrl ? `<a class="btn btn-ghost" href="${previewUrl}" target="_blank" rel="noopener">Preview ↗</a>` : ''}
        ${slug ? `<button id="btn-delete" class="btn btn-danger">Delete</button>` : ''}
      </div>
    </div>

    <div id="editor-errors" class="hidden mt-4 card border-rose-500/40 p-4 text-sm text-rose-300"></div>

    <div class="grid lg:grid-cols-[1fr_300px] gap-5 mt-5 items-start">
      <div class="space-y-4">
        <div class="card p-5 space-y-4">
          ${fields.filter((f) => leadFields.includes(f.name)).map((f) => fieldHtml(f, entry.data[f.name])).join('')}
        </div>
        <div class="card p-5">
          <label class="field-label" for="f-body">Content (Markdown)</label>
          <textarea id="f-body" data-body rows="18" class="field-input font-mono text-[13px] leading-6" placeholder="Write the post or page content here…&#10;&#10;## Heading&#10;Paragraph with **bold** text.">${esc(entry.body || '')}</textarea>
          <p class="field-hint">Markdown: <code>#</code> headings, <code>**bold**</code>, lists, links, tables.</p>
        </div>
      </div>
      <div class="card p-5 space-y-4">
        <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400">Details</h2>
        ${
          slug
            ? `<div><span class="field-label">URL slug</span><p class="text-sm text-slate-300 font-mono break-all">${esc(SLUG_PREFIX[type])}${esc(slug)}/</p></div>`
            : `<div><label class="field-label" for="f-slug">URL slug</label><input id="f-slug" data-slug class="field-input font-mono" placeholder="auto-from-title" /><p class="field-hint">Lowercase letters, numbers and dashes.</p></div>`
        }
        ${fields.filter((f) => !leadFields.includes(f.name)).map((f) => fieldHtml(f, entry.data[f.name])).join('')}
      </div>
    </div>
  `;

  const slugInput = $('[data-slug]', view);
  if (slugInput) {
    const titleInput = $('[data-field="title"]', view);
    let touched = false;
    slugInput.value = suggestSlug(entry.data.title || '');
    slugInput.addEventListener('input', () => {
      touched = true;
    });
    titleInput?.addEventListener('input', () => {
      if (!touched) slugInput.value = suggestSlug(titleInput.value);
    });
  }

  $('#btn-save', view)?.addEventListener('click', () => saveEditor(view, { type, slug }));
  $('#btn-delete', view)?.addEventListener('click', async () => {
    if (!confirm(`Delete "${slug}"? The public page disappears immediately.`)) return;
    try {
      await api(`/admin/api/entry?type=${type}&slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
      state.dirty = false;
      toast('Deleted — the change is live for every visitor');
      location.hash = `#/${type}`;
    } catch (error) {
      toast(error.message, 'err');
    }
  });
}

function collectFields(view) {
  const data = {};
  view.querySelectorAll('[data-field]').forEach((input) => {
    const name = input.dataset.field;
    if (input.type === 'checkbox') {
      data[name] = input.checked;
    } else if (input.dataset.kind === 'list') {
      const raw = input.value || '';
      data[name] =
        input.dataset.split === 'line'
          ? raw.split('\n').map((s) => s.trim()).filter(Boolean)
          : raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    } else if (input.type === 'number') {
      data[name] = input.value === '' ? '' : Number(input.value);
    } else {
      data[name] = input.value ?? '';
    }
  });
  view.querySelectorAll('[data-kind="pairs"]').forEach((wrap) => {
    const name = wrap.dataset.fieldWrap;
    const pairs = [];
    wrap.querySelectorAll('.pair-row').forEach((row) => {
      const value = $('.pair-value', row)?.value.trim() ?? '';
      const label = $('.pair-label', row)?.value.trim() ?? '';
      if (value || label) pairs.push({ value, label });
    });
    data[name] = pairs;
  });
  return data;
}

async function saveEditor(view, { type, slug }) {
  const data = collectFields(view);
  const body = $('[data-body]', view)?.value ?? '';
  const finalSlug = slug || ($('[data-slug]', view)?.value || '').trim();

  const errors = type === 'settings' ? validateSettings(data) : validateEntry(type, data, body);
  if (!slug && type !== 'settings' && !finalSlug) errors.push('URL slug is required');

  const box = $('#editor-errors', view);
  const showError = (list) => {
    box.innerHTML = `<ul class="list-disc pl-5 space-y-1">${list.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  if (errors.length) return showError(errors);
  box.classList.add('hidden');

  try {
    const result = await api('/admin/api/entry', {
      method: 'POST',
      body: { type, slug: finalSlug, data, body },
    });
    state.dirty = false;
    toast('Saved — live now for every visitor');
    if (!slug && result.slug) {
      location.hash = `#/edit/${type}/${encodeURIComponent(result.slug)}`;
    } else {
      route();
    }
  } catch (error) {
    showError(error.data?.errors || [error.message]);
  }
}

// ── settings ────────────────────────────────────────────────────────────
async function renderSettings(view) {
  const entry = (await api('/admin/api/entry?type=settings')).entry;
  state.editor = { type: 'settings', data: { ...entry.data } };

  view.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">Site settings</h1>
        <p class="text-xs text-slate-500 mt-1">${entry.source === 'cms' ? `Saved in the CMS · ${esc(fmtDate(entry.updated_at))}` : 'From the repository (saving stores a CMS copy)'}</p>
      </div>
      <button id="btn-save" class="btn btn-primary">Save settings</button>
    </div>
    <div id="editor-errors" class="hidden mt-4 card border-rose-500/40 p-4 text-sm text-rose-300"></div>
    <div class="space-y-5 mt-5">
      ${SETTINGS_SECTIONS.map(
        (section) => `
        <section class="card p-5">
          <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400 mb-4">${esc(section.title)}</h2>
          <div class="grid sm:grid-cols-2 gap-4">
            ${section.fields.map((f) => fieldHtml(f, entry.data[f.name])).join('')}
          </div>
        </section>`,
      ).join('')}
    </div>
  `;
  $('#btn-save', view)?.addEventListener('click', () => saveEditor(view, { type: 'settings', slug: null }));
}

// ── media ───────────────────────────────────────────────────────────────
async function renderMedia(view) {
  const data = await api('/admin/api/media');
  const items = data.items || [];
  const cards = items
    .map(
      (item) => `
      <div class="card overflow-hidden group">
        <div class="aspect-[3/2] bg-slate-800 grid place-items-center overflow-hidden">
          <img src="${esc(item.path)}" alt="" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.style.display='none'" />
        </div>
        <div class="p-3">
          <p class="text-xs font-mono text-slate-300 truncate" title="${esc(item.path)}">${esc(item.path.split('/').pop())}</p>
          <div class="flex items-center justify-between mt-2 gap-2">
            <button class="text-[11px] font-bold text-amber-400 hover:text-amber-300" data-copy="${esc(item.path)}">Copy URL</button>
            ${
              item.source === 'cms'
                ? `<button class="text-[11px] font-bold text-rose-400 hover:text-rose-300" data-del-media="${esc(item.path)}">Delete</button>`
                : `<span class="text-[11px] text-slate-600">in repo</span>`
            }
          </div>
        </div>
      </div>`,
    )
    .join('');

  view.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">Images</h1>
        <p class="text-sm text-slate-400 mt-1">${items.length} image${items.length === 1 ? '' : 's'} — repo images plus everything uploaded here.</p>
      </div>
      <label class="btn btn-primary cursor-pointer">
        + Upload image
        <input id="media-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" />
      </label>
    </div>
    <p id="media-status" class="hidden mt-4 text-sm"></p>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-5">
      ${cards || `<p class="text-slate-500 col-span-full text-center py-10">No images yet.</p>`}
    </div>
  `;

  $('#media-upload', view)?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const status = $('#media-status', view);
    status.textContent = 'Uploading…';
    status.className = 'mt-4 text-sm text-slate-400';
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api('/admin/api/media', { method: 'POST', body: form });
      toast(`Uploaded ${result.path}`);
      route();
    } catch (error) {
      status.textContent = error.message;
      status.className = 'mt-4 text-sm text-rose-400';
    }
  });
}

/** Media picker modal — hands the chosen path back to a waiting field. */
async function openMediaPicker(onPick) {
  const data = await api('/admin/api/media');
  const items = data.items || [];
  const html = `
    <div class="max-w-3xl mx-auto card p-5">
      <div class="flex items-center justify-between">
        <h2 class="font-extrabold">Choose an image</h2>
        <button id="picker-close" class="btn btn-ghost">Close</button>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 max-h-[60vh] overflow-y-auto pr-1">
        ${items
          .map(
            (item) => `
          <button class="rounded-lg overflow-hidden border border-white/10 hover:border-amber-500 transition bg-slate-800" data-pick="${esc(item.path)}">
            <span class="block aspect-[3/2]"><img src="${esc(item.path)}" alt="" loading="lazy" class="w-full h-full object-cover" onerror="this.style.display='none'" /></span>
            <span class="block text-[10px] font-mono text-slate-400 px-1.5 py-1 truncate text-left">${esc(item.path.split('/').pop())}</span>
          </button>`,
          )
          .join('') || `<p class="text-slate-500 col-span-full py-6 text-center text-sm">No images uploaded yet.</p>`}
      </div>
    </div>
  `;
  openModal(html, (event) => {
    const pick = event.target.closest('[data-pick]');
    if (pick) {
      onPick(pick.dataset.pick);
      closeModal();
      return;
    }
    if (event.target.closest('#picker-close')) closeModal();
  });
}

// ── export & backup ─────────────────────────────────────────────────────
async function renderExport(view) {
  const status = await loadStatus();
  state.status = status;
  view.innerHTML = `
    <h1 class="text-2xl font-extrabold tracking-tight">Export &amp; Backup</h1>
    <p class="text-sm text-slate-400 mt-1">Your live CMS content is stored on the server, not in this browser.</p>
    <div class="grid sm:grid-cols-2 gap-4 mt-5">
      <div class="card p-5">
        <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400">Content backup</h2>
        <p class="text-sm text-slate-300 mt-2 leading-6">Download current pages, posts, projects, settings, deletion markers and uploaded-image details as JSON.</p>
        <a class="btn btn-primary mt-4" href="/admin/api/export?download=1">Download backup (.json)</a>
      </div>
      <div class="card p-5">
        <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400">Live status</h2>
        <p class="text-sm text-slate-300 mt-2 leading-6">${status.counts.blog} blog posts · ${status.counts.pages} pages · ${status.counts.projects} projects · ${status.mediaCount} images.</p>
        <p class="text-sm text-emerald-300 mt-3">✓ Public pages read this shared content directly on every request.</p>
        <a href="/" target="_blank" rel="noopener" class="btn btn-ghost mt-4">Verify live site ↗</a>
      </div>
    </div>
  `;
}

// ── account ─────────────────────────────────────────────────────────────
async function renderAccount(view) {
  const status = await loadStatus();
  view.innerHTML = `
    <h1 class="text-2xl font-extrabold tracking-tight">Account</h1>
    <p class="text-sm text-slate-400 mt-1">Signed in as <strong class="text-slate-200">${esc(status.user)}</strong></p>

    <div class="card p-5 mt-5 max-w-md">
      <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400 mb-4">Change password</h2>
      <form id="pw-form" class="space-y-3">
        <div><label class="field-label" for="pw-current">Current password</label><input id="pw-current" type="password" autocomplete="current-password" required class="field-input" /></div>
        <div><label class="field-label" for="pw-next">New password</label><input id="pw-next" type="password" autocomplete="new-password" minlength="6" required class="field-input" /></div>
        <div><label class="field-label" for="pw-next2">Repeat new password</label><input id="pw-next2" type="password" autocomplete="new-password" minlength="6" required class="field-input" /></div>
        <p id="pw-error" class="hidden text-sm text-rose-400"></p>
        <button class="btn btn-primary" type="submit">Update password</button>
      </form>
    </div>

    <div class="card p-5 mt-4 max-w-md">
      <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400 mb-2">Session</h2>
      <button id="btn-logout" class="btn btn-ghost">Sign out</button>
    </div>
  `;

  $('#pw-form', view)?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = $('#pw-current').value;
    const next = $('#pw-next').value;
    const next2 = $('#pw-next2').value;
    const errorBox = $('#pw-error', view);
    if (next !== next2) {
      errorBox.textContent = 'The new passwords do not match.';
      errorBox.classList.remove('hidden');
      return;
    }
    try {
      await api('/admin/api/change-password', { method: 'POST', body: { current, next } });
      toast('Password updated');
      event.target.reset();
      errorBox.classList.add('hidden');
    } catch (error) {
      errorBox.textContent = error.data?.error || error.message;
      errorBox.classList.remove('hidden');
    }
  });

  $('#btn-logout', view)?.addEventListener('click', async () => {
    try {
      await api('/admin/api/logout', { method: 'POST', body: {} });
    } finally {
      location.reload();
    }
  });
}

// ── login ───────────────────────────────────────────────────────────────
function wireLogin() {
  const form = $('#login-form');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = $('#login-error');
    errorBox.classList.add('hidden');
    const username = $('#login-user').value.trim();
    const password = $('#login-pass').value;
    try {
      const res = await fetch('/admin/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...API_HEADER },
        body: JSON.stringify({ username, password }),
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        errorBox.textContent = data?.error || 'Sign-in failed.';
        errorBox.classList.remove('hidden');
        return;
      }
      if (location.hash) sessionStorage.setItem('admin-hash', location.hash);
      location.reload();
    } catch {
      errorBox.textContent = 'Network error — try again.';
      errorBox.classList.remove('hidden');
    }
  });
}

// ── delegated actions (bound once at boot) ──────────────────────────────
function wireDelegates() {
  // dirty tracking for anything rendered into #view / #modal
  document.addEventListener('input', (event) => {
    if (event.target?.closest?.('#view, #modal')) state.dirty = true;
  });

  document.addEventListener('click', (event) => {
    // media picker buttons next to media fields
    const btn = event.target.closest('[data-picker-for]');
    if (btn) {
      const input = document.getElementById(btn.dataset.pickerFor);
      if (input) {
        openMediaPicker((path) => {
          input.value = path;
          state.dirty = true;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      }
      return;
    }

    // stats rows (site settings)
    const add = event.target.closest('.pair-add');
    if (add) {
      const wrap = add.previousElementSibling;
      if (wrap) {
        const row = document.createElement('div');
        row.className = 'flex gap-2 items-center pair-row';
        row.innerHTML = `
          <input class="field-input pair-value" placeholder="Value (e.g. 120+)" value="" />
          <input class="field-input pair-label" placeholder="Label (e.g. Projects delivered)" value="" />
          <button type="button" class="btn btn-danger pair-remove" title="Remove">×</button>`;
        wrap.appendChild(row);
        state.dirty = true;
      }
      return;
    }
    const remove = event.target.closest('.pair-remove');
    if (remove) {
      remove.closest('.pair-row')?.remove();
      state.dirty = true;
      return;
    }

    // media library actions
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard
        .writeText(location.origin + copy.dataset.copy)
        .then(() => toast('URL copied'))
        .catch(() => toast(copy.dataset.copy));
      return;
    }
    const del = event.target.closest('[data-del-media]');
    if (del) {
      if (!confirm(`Delete ${del.dataset.delMedia}? Pages using it will show a broken image until you update them.`)) return;
      api(`/admin/api/media?path=${encodeURIComponent(del.dataset.delMedia)}`, { method: 'DELETE' })
        .then(() => {
          toast('Image deleted');
          route();
        })
        .catch((error) => toast(error.message, 'err'));
    }
  });
}

// ── boot ────────────────────────────────────────────────────────────────
export function startAdminApp() {
  wireLogin();
  wireDelegates();
  if (!$('#app')) return;
  const saved = sessionStorage.getItem('admin-hash');
  if (saved && !location.hash) {
    sessionStorage.removeItem('admin-hash');
    location.hash = saved;
  }
  window.addEventListener('hashchange', route);
  route();
}
