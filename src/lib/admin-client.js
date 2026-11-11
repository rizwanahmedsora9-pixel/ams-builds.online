// Built-in client-side CMS UI for /admin/.
// Zero backend required — works on static hosting, Vercel, Cloudflare, or offline.
import { CONTENT_FIELDS, SETTINGS_SECTIONS, defaultData, suggestSlug, validateEntry, validateSettings } from './fields.mjs';
import { createClientCms } from './cms-store.mjs';
import { renderMarkdownClient } from './markdown-browser.mjs';

const state = {
  cms: null,
  dirty: false,
  mediaMap: {},
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

function downloadFile(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
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

// ── baseline + auth shell ───────────────────────────────────────────────
async function loadBaseline() {
  const embedded = $('#cms-baseline');
  if (embedded?.textContent) {
    try {
      return JSON.parse(embedded.textContent);
    } catch {
      /* fall back to fetch */
    }
  }
  const res = await fetch('/cms-data.json');
  if (!res.ok) return { entries: [], settings: {}, media: [] };
  return res.json();
}

function syncAuthShell() {
  const session = state.cms.getSession();
  const loginEl = $('#login-screen');
  const appEl = $('#app');
  if (session.authenticated) {
    loginEl?.classList.add('hidden');
    appEl?.classList.remove('hidden');
    document.title = 'Admin · AMS Builds CMS';
    route();
  } else {
    appEl?.classList.add('hidden');
    loginEl?.classList.remove('hidden');
    document.title = 'Sign in · AMS Builds CMS';
  }
}

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
  if (!state.cms?.getSession().authenticated) return;
  const target = parseHash();
  state.dirty = false;
  state.mediaMap = await state.cms.resolveAllMediaMap();
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
  const normalized = name === 'publish' ? 'export' : name;
  document.querySelectorAll('#admin-nav .nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === normalized);
  });
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function resolveImg(path) {
  return state.mediaMap[path] || path || '';
}

// ── views ───────────────────────────────────────────────────────────────
async function renderDashboard(view) {
  const status = await state.cms.getStatus();
  const overrides = state.cms.listOverrides();
  const badge = status.hasOverrides
    ? `<span class="badge bg-amber-500/15 text-amber-300 border border-amber-500/30">${overrides.length} local edit${overrides.length === 1 ? '' : 's'} active</span>`
    : `<span class="badge bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Synced with repo baseline</span>`;

  view.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">Dashboard</h1>
        <p class="text-sm text-slate-400 mt-1">Signed in as <strong class="text-slate-200">${esc(status.user)}</strong> · built-in client-side CMS (browser storage)</p>
      </div>
      ${badge}
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
        <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400">Live updates &amp; export</h2>
        <p class="text-sm text-slate-300 mt-2 leading-6">
          Everything you save updates the live site in this browser immediately. Use <a class="text-amber-400 font-bold" href="#/export">Export &amp; Backup</a> to download backups or content files for git.
        </p>
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

const TYPE_LABELS = { blog: 'Blog posts', pages: 'Pages', projects: 'Projects' };
const TYPE_NEW = { blog: 'New blog post', pages: 'New page', projects: 'New project' };
const SLUG_PREFIX = { blog: '/blog/', pages: '/', projects: '/projects/' };

async function renderList(view, type) {
  const items = state.cms.listContent(type);
  const rows = items
    .map((item) => {
      const title = item.data?.title || item.slug;
      const date = item.data?.pubDate || item.data?.date || '';
      const draft = item.data?.draft ? `<span class="badge bg-slate-700 text-slate-300">draft</span>` : '';
      const source =
        item.source === 'cms'
          ? `<span class="badge bg-amber-500/10 text-amber-300 border border-amber-500/25">${item.hasBaseline ? 'edited' : 'new'}</span>`
          : '';
      const when = date ? `<span class="text-xs text-slate-500">${esc(date)}</span>` : '';
      const prefix = type === 'pages' ? '' : `${type}/`;
      const revertBtn =
        item.source === 'cms' && item.hasBaseline
          ? `<button type="button" class="text-xs font-semibold text-slate-400 hover:text-white mr-3" data-revert-entry="${type}:${esc(item.slug)}">Revert</button>`
          : '';
      return `
        <tr class="table-row">
          <td class="py-3 px-4">
            <a href="#/edit/${type}/${encodeURIComponent(item.slug)}" class="font-semibold text-white hover:text-amber-400">${esc(title)}</a>
            <div class="text-xs text-slate-500 mt-0.5">/${prefix}${esc(item.slug)}/ ${draft} ${source}</div>
          </td>
          <td class="py-3 px-3 text-right whitespace-nowrap">${when}</td>
          <td class="py-3 px-4 text-right whitespace-nowrap">
            ${revertBtn}
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

  view.querySelectorAll('[data-revert-entry]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [t, s] = btn.dataset.revertEntry.split(':');
      if (!confirm(`Revert "${s}" back to the repository version?`)) return;
      state.cms.revertEntry(t, s);
      toast('Reverted to repository version');
      route();
    });
  });
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
    const previewSrc = val ? resolveImg(val) : '';
    return `<div>
      ${label}
      <div class="flex gap-2">${input}<button type="button" class="btn btn-ghost shrink-0" data-picker-for="${id}">Choose</button></div>
      <img data-preview-for="${id}" src="${esc(previewSrc)}" alt="" class="${previewSrc ? '' : 'hidden '}mt-2 h-24 w-full object-cover rounded-lg border border-white/10 bg-slate-800" />
      ${hint}
    </div>`;
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
    entry = state.cms.getEntry(type, slug);
    if (!entry) {
      view.innerHTML = `<div class="card p-6 text-rose-300 text-sm">Entry "${esc(slug)}" was not found. <a href="#/${type}" class="text-amber-400 underline">Back to list</a></div>`;
      return;
    }
  } else {
    entry = { type, slug: null, data: defaultData(type), body: '', source: 'new', hasBaseline: false, updated_at: null };
  }

  const title = entry.data.title || (slug ? slug : TYPE_NEW[type]);
  const previewUrl = slug && entry.data.draft !== true ? `${SLUG_PREFIX[type]}${slug}/` : null;
  const leadFields = ['title', 'description', 'heroTitle', 'heroSubtitle'];

  view.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <a href="#/${type}" class="text-xs text-slate-500 hover:text-slate-300">← ${esc(TYPE_LABELS[type])}</a>
        <h1 class="text-2xl font-extrabold tracking-tight truncate">${slug ? 'Edit' : 'Create'}: ${esc(title)}</h1>
        <p class="text-xs text-slate-500 mt-1">
          ${entry.source === 'file' ? 'From repository baseline (saving stores a live CMS copy)' : entry.source === 'cms' ? `Saved in client CMS · ${esc(fmtDate(entry.updated_at))}` : 'New entry'}
          ${entry.data.draft ? '<span class="badge bg-slate-700 text-slate-300 ml-1">draft</span>' : ''}
        </p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button id="btn-save" class="btn btn-primary">Save</button>
        ${previewUrl ? `<a class="btn btn-ghost" href="${previewUrl}" target="_blank" rel="noopener">View on site ↗</a>` : ''}
        ${slug ? `<button id="btn-download-md" class="btn btn-ghost">Download .md</button>` : ''}
        ${slug && entry.source === 'cms' && entry.hasBaseline ? `<button id="btn-revert" class="btn btn-ghost">Revert</button>` : ''}
        ${slug ? `<button id="btn-delete" class="btn btn-danger">Delete</button>` : ''}
      </div>
    </div>

    <div id="editor-errors" class="hidden mt-4 card border-rose-500/40 p-4 text-sm text-rose-300"></div>

    <div class="grid lg:grid-cols-[1fr_320px] gap-5 mt-5 items-start">
      <div class="space-y-4">
        <div class="card p-5 space-y-4">
          ${fields.filter((f) => leadFields.includes(f.name)).map((f) => fieldHtml(f, entry.data[f.name])).join('')}
        </div>
        <div class="card p-5">
          <div class="flex items-center justify-between mb-2">
            <label class="field-label mb-0" for="f-body">Content (Markdown)</label>
            <div class="inline-flex rounded-lg bg-slate-950 p-0.5 border border-white/10 text-xs">
              <button type="button" id="tab-write" class="px-2.5 py-1 rounded-md bg-amber-500 text-slate-900 font-bold">Write</button>
              <button type="button" id="tab-preview" class="px-2.5 py-1 rounded-md text-slate-400 hover:text-white font-semibold">Preview</button>
            </div>
          </div>
          <textarea id="f-body" data-body rows="18" class="field-input font-mono text-[13px] leading-6" placeholder="Write the post or page content here…&#10;&#10;## Heading&#10;Paragraph with **bold** text.">${esc(entry.body || '')}</textarea>
          <div id="md-preview" class="hidden bg-white text-slate-800 rounded-xl p-6 prose-ams max-h-[540px] overflow-y-auto"></div>
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

  // Write / Preview markdown tab toggle
  const tabWrite = $('#tab-write', view);
  const tabPreview = $('#tab-preview', view);
  const bodyEl = $('#f-body', view);
  const previewEl = $('#md-preview', view);
  tabWrite?.addEventListener('click', () => {
    bodyEl?.classList.remove('hidden');
    previewEl?.classList.add('hidden');
    tabWrite.className = 'px-2.5 py-1 rounded-md bg-amber-500 text-slate-900 font-bold';
    tabPreview.className = 'px-2.5 py-1 rounded-md text-slate-400 hover:text-white font-semibold';
  });
  tabPreview?.addEventListener('click', () => {
    if (previewEl && bodyEl) {
      previewEl.innerHTML = renderMarkdownClient(bodyEl.value);
      previewEl.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src');
        if (src && state.mediaMap[src]) img.setAttribute('src', state.mediaMap[src]);
      });
    }
    bodyEl?.classList.add('hidden');
    previewEl?.classList.remove('hidden');
    tabPreview.className = 'px-2.5 py-1 rounded-md bg-amber-500 text-slate-900 font-bold';
    tabWrite.className = 'px-2.5 py-1 rounded-md text-slate-400 hover:text-white font-semibold';
  });

  // Live thumbnail update for media inputs
  view.querySelectorAll('input[data-field]').forEach((input) => {
    const thumb = view.querySelector(`[data-preview-for="${input.id}"]`);
    if (!thumb) return;
    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (!val) {
        thumb.classList.add('hidden');
        thumb.removeAttribute('src');
      } else {
        thumb.src = resolveImg(val);
        thumb.classList.remove('hidden');
      }
    });
  });

  $('#btn-save', view)?.addEventListener('click', () => saveEditor(view, { type, slug }));
  $('#btn-download-md', view)?.addEventListener('click', () => {
    const md = state.cms.formatEntryMarkdown(type, slug);
    if (md) downloadFile(`${slug}.md`, md, 'text/markdown;charset=utf-8');
  });
  $('#btn-revert', view)?.addEventListener('click', () => {
    if (!confirm(`Revert "${slug}" back to the repository default?`)) return;
    state.cms.revertEntry(type, slug);
    state.dirty = false;
    toast('Reverted to repository version');
    route();
  });
  $('#btn-delete', view)?.addEventListener('click', () => {
    if (!confirm(`Delete "${slug}"? It will be hidden on the site immediately.`)) return;
    state.cms.deleteEntry(type, slug);
    state.dirty = false;
    toast('Deleted from site');
    location.hash = `#/${type}`;
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

function saveEditor(view, { type, slug }) {
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

  const result =
    type === 'settings'
      ? state.cms.saveSettings(data)
      : state.cms.saveEntry(type, finalSlug, data, body);

  if (!result.ok) return showError(result.errors || ['Could not save entry']);

  state.dirty = false;
  toast('Saved — changes are live on the site in this browser');
  if (type !== 'settings' && !slug && result.slug) {
    location.hash = `#/edit/${type}/${encodeURIComponent(result.slug)}`;
  } else {
    route();
  }
}

// ── settings ────────────────────────────────────────────────────────────
async function renderSettings(view) {
  const entry = state.cms.getSettings();

  view.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-2xl font-extrabold tracking-tight">Site settings</h1>
        <p class="text-xs text-slate-500 mt-1">${entry.source === 'cms' ? `Saved in client CMS · ${esc(fmtDate(entry.updated_at))}` : 'From repository baseline'}</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button id="btn-save" class="btn btn-primary">Save settings</button>
        <button id="btn-download-yml" class="btn btn-ghost">Download site.yml</button>
        ${entry.source === 'cms' ? `<button id="btn-revert-settings" class="btn btn-ghost">Revert</button>` : ''}
      </div>
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

  view.querySelectorAll('input[data-field]').forEach((input) => {
    const thumb = view.querySelector(`[data-preview-for="${input.id}"]`);
    if (!thumb) return;
    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (!val) {
        thumb.classList.add('hidden');
        thumb.removeAttribute('src');
      } else {
        thumb.src = resolveImg(val);
        thumb.classList.remove('hidden');
      }
    });
  });

  $('#btn-save', view)?.addEventListener('click', () => saveEditor(view, { type: 'settings', slug: null }));
  $('#btn-download-yml', view)?.addEventListener('click', () => {
    downloadFile('site.yml', state.cms.formatSettingsYaml(), 'text/yaml;charset=utf-8');
  });
  $('#btn-revert-settings', view)?.addEventListener('click', () => {
    if (!confirm('Revert Site Settings back to repository defaults?')) return;
    state.cms.revertSettings();
    state.dirty = false;
    toast('Settings reverted');
    route();
  });
}

// ── media ───────────────────────────────────────────────────────────────
async function renderMedia(view) {
  const items = await state.cms.listMedia();
  const cards = items
    .map(
      (item) => `
      <div class="card overflow-hidden group">
        <div class="aspect-[16/10] bg-slate-800 grid place-items-center overflow-hidden">
          <img src="${esc(item.url || item.path)}" alt="" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.style.display='none'" />
        </div>
        <div class="p-3">
          <p class="text-xs font-mono text-slate-300 truncate" title="${esc(item.path)}">${esc(item.path.split('/').pop())}</p>
          <div class="flex items-center justify-between mt-2 gap-2">
            <button class="text-[11px] font-bold text-amber-400 hover:text-amber-300" data-copy="${esc(item.path)}">Copy path</button>
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
        <p class="text-sm text-slate-400 mt-1">${items.length} image${items.length === 1 ? '' : 's'} — repository images plus uploads saved in this browser.</p>
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
      const dataUrl = await readFileAsDataUrl(file);
      const result = await state.cms.uploadMedia({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl,
      });
      if (!result.ok) throw new Error(result.error || 'Upload failed');
      toast(`Uploaded ${result.path}`);
      route();
    } catch (error) {
      status.textContent = error.message;
      status.className = 'mt-4 text-sm text-rose-400';
    }
  });
}

async function openMediaPicker(onPick) {
  const items = await state.cms.listMedia();
  const html = `
    <div class="max-w-3xl mx-auto card p-5">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <h2 class="font-extrabold">Choose an image</h2>
        <div class="flex gap-2">
          <label class="btn btn-primary cursor-pointer text-xs">
            + Upload new
            <input id="picker-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" />
          </label>
          <button id="picker-close" class="btn btn-ghost text-xs">Close</button>
        </div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 max-h-[60vh] overflow-y-auto pr-1">
        ${
          items
            .map(
              (item) => `
          <button class="rounded-lg overflow-hidden border border-white/10 hover:border-amber-500 transition bg-slate-800" data-pick="${esc(item.path)}">
            <span class="block aspect-[16/10]"><img src="${esc(item.url || item.path)}" alt="" loading="lazy" class="w-full h-full object-cover" onerror="this.style.display='none'" /></span>
            <span class="block text-[10px] font-mono text-slate-400 px-1.5 py-1 truncate text-left">${esc(item.path.split('/').pop())}</span>
          </button>`,
            )
            .join('') || `<p class="text-slate-500 col-span-full py-6 text-center text-sm">No images yet.</p>`
        }
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

  $('#picker-upload')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const result = await state.cms.uploadMedia({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl,
      });
      if (!result.ok) throw new Error(result.error || 'Upload failed');
      state.mediaMap = await state.cms.resolveAllMediaMap();
      onPick(result.path);
      closeModal();
      toast(`Uploaded & selected ${result.path}`);
    } catch (error) {
      toast(error.message, 'err');
    }
  });
}

// ── export & backup ─────────────────────────────────────────────────────
async function renderExport(view) {
  const overrides = state.cms.listOverrides();
  const status = await state.cms.getStatus();

  const overrideRows = overrides
    .map(
      (item) => `
      <tr class="table-row">
        <td class="py-2.5 px-4">
          <span class="font-semibold text-white">${esc(item.title)}</span>
          <span class="badge bg-amber-500/15 text-amber-300 ml-2">${esc(item.kind)}</span>
          <div class="text-xs text-slate-500 mt-0.5">${esc(item.type)} / ${esc(item.slug)}</div>
        </td>
        <td class="py-2.5 px-4 text-right whitespace-nowrap space-x-2">
          ${
            item.kind !== 'deleted'
              ? `<button class="text-xs font-bold text-amber-400 hover:text-amber-300" data-dl-entry="${esc(item.type)}:${esc(item.slug)}">Download file</button>`
              : ''
          }
          <button class="text-xs font-bold text-slate-400 hover:text-white" data-revert-ov="${esc(item.type)}:${esc(item.slug)}">Revert</button>
        </td>
      </tr>`,
    )
    .join('');

  view.innerHTML = `
    <h1 class="text-2xl font-extrabold tracking-tight">Export &amp; Backup</h1>
    <p class="text-sm text-slate-400 mt-1">All saves apply live in this browser. Export backups to transfer edits or download content files to commit into git.</p>

    <div class="grid sm:grid-cols-2 gap-4 mt-5">
      <div class="card p-5">
        <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400">JSON Backup</h2>
        <p class="text-sm text-slate-300 mt-2 leading-6">Export all CMS edits, settings, and uploaded images to one JSON file — or restore from a previous backup.</p>
        <div class="flex flex-wrap gap-2 mt-4">
          <button id="btn-export-json" class="btn btn-primary">Download backup (.json)</button>
          <label class="btn btn-ghost cursor-pointer">
            Import backup
            <input id="import-json" type="file" accept="application/json,.json" class="hidden" />
          </label>
        </div>
      </div>

      <div class="card p-5">
        <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400">Live status &amp; reset</h2>
        <p class="text-sm text-slate-300 mt-2 leading-6">
          ${status.hasOverrides ? `${overrides.length} content override(s) and ${status.uploadedMediaCount} uploaded image(s) active in browser storage.` : 'No local overrides — showing exact repository files.'}
        </p>
        <div class="flex flex-wrap gap-2 mt-4">
          <a href="/" target="_blank" rel="noopener" class="btn btn-ghost">Preview live site ↗</a>
          ${status.hasOverrides ? `<button id="btn-reset-all" class="btn btn-danger">Reset all local edits</button>` : ''}
        </div>
      </div>
    </div>

    <div class="card mt-5 overflow-hidden">
      <div class="px-5 py-3 border-b border-white/10 flex items-center justify-between">
        <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400">Active local changes</h2>
        <span class="text-xs text-slate-500">${overrides.length} item${overrides.length === 1 ? '' : 's'}</span>
      </div>
      ${
        overrides.length
          ? `<table class="w-full text-sm"><tbody>${overrideRows}</tbody></table>`
          : `<p class="p-6 text-sm text-slate-500 text-center">No modified entries yet.</p>`
      }
    </div>
  `;

  $('#btn-export-json', view)?.addEventListener('click', async () => {
    const payload = await state.cms.exportBackup();
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`ams-cms-backup-${date}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('Backup exported');
  });

  $('#import-json', view)?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await state.cms.importBackup(payload);
      if (!res.ok) throw new Error(res.error || 'Import failed');
      toast('Backup imported successfully');
      route();
    } catch (error) {
      toast(error.message || 'Invalid backup file', 'err');
    }
  });

  $('#btn-reset-all', view)?.addEventListener('click', async () => {
    if (!confirm('Discard ALL local CMS edits and uploaded images? This resets everything to repository defaults.')) return;
    await state.cms.resetAll();
    toast('All local CMS edits cleared');
    route();
  });

  view.querySelectorAll('[data-dl-entry]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [type, slug] = btn.dataset.dlEntry.split(':');
      if (type === 'settings') {
        downloadFile('site.yml', state.cms.formatSettingsYaml(), 'text/yaml;charset=utf-8');
      } else {
        const md = state.cms.formatEntryMarkdown(type, slug);
        if (md) downloadFile(`${slug}.md`, md, 'text/markdown;charset=utf-8');
      }
    });
  });

  view.querySelectorAll('[data-revert-ov]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [type, slug] = btn.dataset.revertOv.split(':');
      if (!confirm(`Revert "${slug}" back to repository default?`)) return;
      if (type === 'settings') state.cms.revertSettings();
      else state.cms.revertEntry(type, slug);
      toast('Reverted');
      route();
    });
  });
}

// ── account ─────────────────────────────────────────────────────────────
async function renderAccount(view) {
  const status = await state.cms.getStatus();
  view.innerHTML = `
    <h1 class="text-2xl font-extrabold tracking-tight">Account</h1>
    <p class="text-sm text-slate-400 mt-1">Signed in as <strong class="text-slate-200">${esc(status.user)}</strong></p>

    <div class="card p-5 mt-5 max-w-md space-y-2 text-sm text-slate-300">
      <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400 mb-2">CMS Mode</h2>
      <p><strong>Authentication:</strong> Built-in hardcoded admin credentials</p>
      <p><strong>Storage:</strong> Client-side browser storage (localStorage + IndexedDB)</p>
      <p><strong>Active overrides:</strong> ${status.overrideCount} entry edit(s) · ${status.uploadedMediaCount} uploaded image(s)</p>
    </div>

    <div class="card p-5 mt-4 max-w-md">
      <h2 class="font-bold text-sm uppercase tracking-wider text-slate-400 mb-2">Session</h2>
      <button id="btn-logout" class="btn btn-ghost">Sign out</button>
    </div>
  `;

  $('#btn-logout', view)?.addEventListener('click', () => {
    state.cms.logout();
    state.dirty = false;
    syncAuthShell();
  });
}

// ── login & delegates ───────────────────────────────────────────────────
function wireLogin() {
  const form = $('#login-form');
  if (!form) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const errorBox = $('#login-error');
    errorBox.classList.add('hidden');
    const username = $('#login-user').value.trim();
    const password = $('#login-pass').value;
    const result = state.cms.login(username, password);
    if (!result.ok) {
      errorBox.textContent = result.error || 'Invalid username or password.';
      errorBox.classList.remove('hidden');
      return;
    }
    form.reset();
    syncAuthShell();
  });
}

function wireDelegates() {
  document.addEventListener('input', (event) => {
    if (event.target?.closest?.('#view, #modal')) state.dirty = true;
  });

  document.addEventListener('click', (event) => {
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

    const copy = event.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard
        ?.writeText(copy.dataset.copy)
        .then(() => toast(`Copied ${copy.dataset.copy}`))
        .catch(() => toast(copy.dataset.copy));
      return;
    }

    const del = event.target.closest('[data-del-media]');
    if (del) {
      if (!confirm(`Delete ${del.dataset.delMedia}?`)) return;
      state.cms.deleteMedia(del.dataset.delMedia).then(() => {
        toast('Image deleted');
        route();
      });
    }
  });
}

// ── boot ────────────────────────────────────────────────────────────────
export async function startAdminApp() {
  const baseline = await loadBaseline();
  state.cms = createClientCms({ baseline });
  wireLogin();
  wireDelegates();
  window.addEventListener('hashchange', route);
  syncAuthShell();
}
