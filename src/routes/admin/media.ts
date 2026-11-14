import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can, randomToken } from '../../lib/auth';
import { bumpCache } from '../../lib/config';
import { mediaUrl } from '../../lib/content';
import { slugify } from '../../lib/security';
import { MAX_FILE_BYTES as MAX_BYTES, deleteFile, putFile } from '../../lib/files';
import { ADMIN_ONLY_EXT, FILE_ACCEPT, FILE_TYPES, isImageMime } from '../../lib/media-types';
import { MEDIA_COMPRESS_JS } from '../../admin/media-compress';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';

const media = new Hono<AppEnv>();

// The stored Content-Type comes from this table, never from the browser.
const TYPES = FILE_TYPES;
const ADMIN_ONLY = ADMIN_ONLY_EXT;

const fmtSize = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

type MediaTypeFilter = 'all' | 'images' | 'audio' | 'video' | 'documents' | 'fonts';
type MediaView = 'grid' | 'list';
type MediaListState = { type: MediaTypeFilter; month: string; q: string; view: MediaView; bulk: boolean; alt: boolean; p: number };
type MediaListRow = { id: number; r2_key: string; filename: string; mime: string; size: number; uploaded_by: number | null; created_at: string };

function mediaListState(c: Ctx): MediaListState {
  const rawType = c.req.query('type') || 'all';
  const rawView = c.req.query('view') || 'grid';
  const rawPage = Number(c.req.query('p')) || 1;
  const month = c.req.query('month') || '';
  return {
    type: ['all', 'images', 'audio', 'video', 'documents', 'fonts'].includes(rawType) ? rawType as MediaTypeFilter : 'all',
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : '',
    q: (c.req.query('q') || '').trim().slice(0, 120),
    view: rawView === 'list' ? 'list' : 'grid',
    bulk: c.req.query('bulk') === '1',
    // ?alt=missing is the "fix your alt text" view, linked from the dashboard.
    alt: c.req.query('alt') === 'missing',
    p: Math.min(100_000, Math.max(1, Math.trunc(rawPage) || 1)),
  };
}

function mediaListHref(state: MediaListState, change: Partial<MediaListState> = {}): string {
  const next = { ...state, ...change };
  const params = new URLSearchParams();
  if (next.type !== 'all') params.set('type', next.type);
  if (next.month) params.set('month', next.month);
  if (next.q) params.set('q', next.q);
  if (next.view !== 'grid') params.set('view', next.view);
  if (next.bulk) params.set('bulk', '1');
  if (next.alt) params.set('alt', 'missing');
  if (next.p > 1) params.set('p', String(next.p));
  const query = params.toString();
  return '/media' + (query ? '?' + query : '');
}

function mediaListRedirect(c: Ctx, state: MediaListState, message: string, isError = false): Response {
  const path = mediaListHref(state);
  const key = isError ? 'err' : 'ok';
  return c.redirect(c.var.base + path + (path.includes('?') ? '&' : '?') + key + '=' + encodeURIComponent(message), 303);
}

function mediaMonthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function mediaKind(mime: string): string {
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('audio/')) return 'Audio';
  if (mime.startsWith('video/')) return 'Video';
  if (mime.startsWith('font/')) return 'Font';
  return 'Document';
}

media.get('/media', async (c) => {
  const state = mediaListState(c);
  const base = c.var.base;
  const per = 48;
  const where = ['m.site_id=1'];
  const args: (string | number)[] = [];
  const typeWhere: Partial<Record<MediaTypeFilter, string>> = {
    images: "m.mime LIKE 'image/%'",
    audio: "m.mime LIKE 'audio/%'",
    video: "m.mime LIKE 'video/%'",
    documents: "(m.mime LIKE 'application/%' OR m.mime LIKE 'text/%')",
    fonts: "m.mime LIKE 'font/%'",
  };
  if (state.type !== 'all') where.push(typeWhere[state.type]!);
  if (state.month) { where.push('substr(m.created_at,1,7)=?'); args.push(state.month); }
  if (state.q) { where.push('instr(lower(m.filename),lower(?))>0'); args.push(state.q); }
  if (state.alt) where.push("(m.alt IS NULL OR trim(m.alt)='')");
  const whereSql = where.join(' AND ');
  const [listResult, totalRow, months] = await Promise.all([
    c.env.DB.prepare(`SELECT m.id,m.r2_key,m.filename,m.mime,m.size,m.uploaded_by,m.created_at
      FROM media m WHERE ${whereSql} ORDER BY m.id DESC LIMIT ? OFFSET ?`)
      .bind(...args, per + 1, (state.p - 1) * per).all<MediaListRow>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM media m WHERE ${whereSql}`).bind(...args).first<{ n: number }>(),
    c.env.DB.prepare("SELECT DISTINCT substr(created_at,1,7) AS month FROM media WHERE site_id=1 ORDER BY month DESC LIMIT 24")
      .all<{ month: string }>(),
  ]);
  const rows = listResult.results.slice(0, per);
  const total = Number(totalRow?.n || 0);
  const monthOptions = months.results.filter((row) => /^\d{4}-(0[1-9]|1[0-2])$/.test(row.month));
  const currentUrl = mediaListHref(state);
  const bulkAction = `${base}/media/bulk${currentUrl.slice('/media'.length)}`;
  const rangeStart = total ? (state.p - 1) * per + 1 : 0;
  const rangeEnd = Math.min((state.p - 1) * per + rows.length, total);
  const accept = FILE_ACCEPT;
  const actions = (m: MediaListRow, url: string) => {
    const mine = can(c.var.user, 'manage_media') || m.uploaded_by === c.var.user.id;
    return html`<button type="button" class="btn ghost small" data-copy="${url}">Copy URL</button>
      ${mine ? html`<form method="post" action="${base}/media/${m.id}/delete" class="inline" data-confirm>${csrfField(c)}<button class="btn danger small" type="submit">Delete</button></form>` : ''}`;
  };
  const thumbnail = (m: MediaListRow, url: string) => m.mime.startsWith('image/')
    ? html`<img src="${url}" alt="" loading="lazy">`
    : html`<span class="media-file-icon" aria-hidden="true">${(m.filename.split('.').pop() || 'file').toUpperCase()}</span>`;

  return layout(c, 'Media Library', html`
<section class="media-admin" aria-labelledby="media-title">
  <form method="post" action="${bulkAction}" id="media-bulk-form" class="media-bulk-form">${csrfField(c)}</form>
  <header class="media-heading-row">
    <h1 id="media-title">Media Library</h1>
    <details class="media-upload" id="upload">
      <summary class="btn ghost small">Add Media File</summary>
      <form method="post" action="${base}/media/upload" enctype="multipart/form-data" class="media-upload-form">
        ${csrfField(c)}
        <label for="files" style="margin-top:0">Choose files to upload</label>
        <input type="file" id="files" name="files" multiple required accept="${accept}">
        <label for="media-target">Maximum size per image</label>
        <select id="media-target" name="targetKB" data-target>
          <option value="100" selected>100 KB — maximum compression (recommended)</option>
          <option value="50">50 KB — extra small, lower detail</option>
          <option value="200">200 KB — small</option>
          <option value="500">500 KB — larger</option>
          <option value="0">Keep originals, no conversion</option>
        </select>
        <p class="hint">JPG, PNG, GIF, WebP, AVIF, BMP, TIFF, HEIC, SVG and more, plus PDF, audio, video and fonts. Static images are compressed to WebP in your browser until they fit the size target — a 10 MB photo still uploads at about 100 KB. GIF/APNG animation, animated WebP and SVG stay as they are. Up to ${fmtSize(MAX_BYTES)} per source file.</p>
        <p class="hint" data-compress-status role="status" aria-live="polite"></p>
        <button class="btn" type="submit">Upload</button>
      </form>
    </details>
  </header>
  <div class="media-toolbar">
    <div class="media-toolbar-left">
      <nav class="media-view-toggle" aria-label="Media view">
        <a href="${mediaListHref(state, { view: 'list', p: 1 })}" class="${state.view === 'list' ? 'current' : ''}" aria-label="List view" title="List view"${state.view === 'list' ? raw(' aria-current="page"') : ''}><span aria-hidden="true">☷</span></a>
        <a href="${mediaListHref(state, { view: 'grid', p: 1 })}" class="${state.view === 'grid' ? 'current' : ''}" aria-label="Grid view" title="Grid view"${state.view === 'grid' ? raw(' aria-current="page"') : ''}><span aria-hidden="true">▦</span></a>
      </nav>
      <form method="get" action="${base}/media" class="media-filter-form">
        ${state.q ? html`<input type="hidden" name="q" value="${state.q}">` : ''}
        ${state.view === 'list' ? html`<input type="hidden" name="view" value="list">` : ''}
        ${state.bulk ? html`<input type="hidden" name="bulk" value="1">` : ''}
        <label class="sr-only" for="media-type">Filter by media type</label>
        <select id="media-type" name="type">
          <option value="all"${state.type === 'all' ? raw(' selected') : ''}>All media items</option>
          <option value="images"${state.type === 'images' ? raw(' selected') : ''}>Images</option>
          <option value="audio"${state.type === 'audio' ? raw(' selected') : ''}>Audio</option>
          <option value="video"${state.type === 'video' ? raw(' selected') : ''}>Video</option>
          <option value="documents"${state.type === 'documents' ? raw(' selected') : ''}>Documents</option>
          <option value="fonts"${state.type === 'fonts' ? raw(' selected') : ''}>Fonts</option>
        </select>
        <label class="sr-only" for="media-month">Filter by upload date</label>
        <select id="media-month" name="month">
          <option value="">All dates</option>
          ${state.month && !monthOptions.some((row) => row.month === state.month) ? html`<option value="${state.month}" selected>${mediaMonthLabel(state.month)}</option>` : ''}
          ${monthOptions.map((row) => html`<option value="${row.month}"${state.month === row.month ? raw(' selected') : ''}>${mediaMonthLabel(row.month)}</option>`)}
        </select>
        <button class="btn ghost small" type="submit">Filter</button>
      </form>
      ${state.bulk ? html`<div class="media-bulk-actions">
        <label class="media-select-all"><input type="checkbox" id="media-select-all"> Select all</label>
        <a class="btn ghost small" href="${mediaListHref(state, { bulk: false, p: 1 })}">Cancel</a>
        <button class="btn danger small" type="submit" form="media-bulk-form" id="media-delete-selected">Delete selected</button>
      </div>` : html`<a class="btn ghost small media-bulk-toggle" href="${mediaListHref(state, { bulk: true, p: 1 })}">Bulk select</a>`}
    </div>
    <form method="get" action="${base}/media" class="media-search-form" role="search">
      ${state.type !== 'all' ? html`<input type="hidden" name="type" value="${state.type}">` : ''}
      ${state.month ? html`<input type="hidden" name="month" value="${state.month}">` : ''}
      ${state.view === 'list' ? html`<input type="hidden" name="view" value="list">` : ''}
      ${state.bulk ? html`<input type="hidden" name="bulk" value="1">` : ''}
      <label for="media-search">Search media</label>
      <input type="search" id="media-search" name="q" value="${state.q}" maxlength="120" aria-label="Search media">
      <button class="sr-only" type="submit">Search media</button>
    </form>
  </div>
  ${rows.length ? state.view === 'grid' ? html`<div class="media media-gallery${state.bulk ? ' is-bulk' : ''}">
    ${rows.map((m) => {
      const url = mediaUrl(m.r2_key);
      return html`<figure class="media-item">
        ${state.bulk ? html`<label class="media-select"><input type="checkbox" name="ids" value="${m.id}" form="media-bulk-form" aria-label="Select ${m.filename}"><span class="sr-only">Select ${m.filename}</span></label>` : ''}
        <a class="thumb" href="${url}" target="_blank" rel="noopener">${thumbnail(m, url)}</a>
        <figcaption><strong>${m.filename}</strong><span>${fmtSize(m.size)} · ${m.created_at.slice(0, 10)}</span></figcaption>
        <div class="row media-item-actions">${actions(m, url)}</div>
      </figure>`;
    })}
  </div>` : html`<div class="media-list-wrap"><table class="media-list-table">
    <thead><tr>${state.bulk ? html`<th class="media-check-col"><input type="checkbox" id="media-select-all-list" aria-label="Select all files"></th>` : ''}<th>File</th><th>Type</th><th>Date uploaded</th><th>File size</th><th>URL</th></tr></thead>
    <tbody>${rows.map((m) => {
      const url = mediaUrl(m.r2_key);
      return html`<tr>
        ${state.bulk ? html`<td class="media-check-col"><input type="checkbox" name="ids" value="${m.id}" form="media-bulk-form" aria-label="Select ${m.filename}"></td>` : ''}
        <td><div class="media-list-file"><a class="media-list-thumb" href="${url}" target="_blank" rel="noopener">${thumbnail(m, url)}</a><span><strong>${m.filename}</strong><small>${m.mime}</small></span></div></td>
        <td>${mediaKind(m.mime)}</td><td>${m.created_at.slice(0, 10)}</td><td>${fmtSize(m.size)}</td><td><div class="row media-item-actions">${actions(m, url)}</div></td>
      </tr>`;
    })}</tbody>
  </table></div>` : html`<div class="media-empty">No media items found.</div>`}
  <div class="media-footer">
    <span class="posts-count">${total ? `Showing ${rangeStart}–${rangeEnd} of ${total} items` : '0 items'}</span>
    <div class="posts-pagination">
      ${state.p > 1 ? html`<a class="btn ghost small" href="${mediaListHref(state, { p: state.p - 1 })}">&larr; Newer</a>` : ''}
      ${total > state.p * per ? html`<a class="btn ghost small" href="${mediaListHref(state, { p: state.p + 1 })}">Older &rarr;</a>` : ''}
    </div>
  </div>
  ${raw(MEDIA_COMPRESS_JS)}
  ${raw(`<script>
(function(){
  var upload=document.getElementById('upload');if(location.hash==='#upload'&&upload)upload.open=true;
  function bindSelectAll(id){var all=document.getElementById(id),boxes=[].slice.call(document.querySelectorAll('input[name="ids"][form="media-bulk-form"]'));
    if(!all)return;all.addEventListener('change',function(){boxes.forEach(function(box){box.checked=all.checked})})}
  bindSelectAll('media-select-all');bindSelectAll('media-select-all-list');
  document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){
    var u=b.getAttribute('data-copy');
    (navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy URL'},1200)},function(){prompt('Copy this URL',u)})})});
  document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm('Delete this file permanently?'))e.preventDefault()})});
  var form=document.getElementById('media-bulk-form');if(form)form.addEventListener('submit',function(e){if(!confirm('Delete the selected media files permanently? This cannot be undone.'))e.preventDefault()});
  // Compress images in the browser before the normal form submit reaches the
  // server, so the stored file (and every visitor's download) fits the target.
  // The submit button stays disabled while a pass is running, and changing the
  // target re-runs the pass on the originally selected files, not on the WebP
  // files a previous pass already swapped in.
  var upForm=document.querySelector('.media-upload-form');
  if(upForm&&window.amsCompressImages){
    var upInput=upForm.querySelector('input[type=file]');
    var upTarget=upForm.querySelector('[data-target]');
    var upNote=upForm.querySelector('[data-compress-status]');
    var upBtn=upForm.querySelector('button[type=submit]');
    var originals=[],version=0,busy=false;
    function upBusy(value){busy=value;if(upBtn)upBtn.disabled=value;}
    function prepare(){
      var run=++version;
      if(!originals.length){upBusy(false);if(upNote)upNote.textContent='';return}
      var value=upTarget?parseFloat(upTarget.value):100;
      if(isNaN(value))value=100;
      upBusy(true);
      if(upNote)upNote.textContent=value>0?'Compressing '+originals.length+' file'+(originals.length===1?'':'s')+' to ≤'+value+' KB per image…':'Preparing files…';
      window.amsCompressImages(originals,value>0?{targetKB:value}:{convert:false}).then(function(results){
        if(run!==version)return;
        var dt=null;try{dt=new DataTransfer()}catch(err){}
        var saved=0,failed=0,ready=0,changed=false;
        results.forEach(function(r){
          if(r.failed){failed++;return}
          ready++;saved+=Math.max(0,(r.original.size||0)-(r.file.size||0));
          if(r.changed)changed=true;
          if(dt)dt.items.add(r.file);
        });
        var swapped=false;
        if(dt){try{upInput.files=dt.files;swapped=true}catch(err){}}
        if(!swapped&&changed){
          upBusy(true);
          if(upNote)upNote.textContent='This browser cannot swap in the compressed files. Use the editor Media picker, or choose Keep originals.';
          return;
        }
        upBusy(ready===0);
        if(upNote)upNote.textContent=(saved&&window.amsFmtSize?window.amsFmtSize(saved)+' saved. ':'')+
          (failed?failed+' could not be read or compressed and were skipped. Choose Keep originals to upload them unchanged. ':'')+
          (ready?'Ready to upload.':'No usable files. Choose other files or keep originals.');
      },function(){
        if(run!==version)return;
        upBusy(false);
        if(upNote)upNote.textContent='Could not compress these files. Choose them again or keep originals.';
      });
    }
    if(upInput)upInput.addEventListener('change',function(){originals=[].slice.call(upInput.files||[]);prepare()});
    if(upTarget)upTarget.addEventListener('change',function(){if(originals.length)prepare()});
    upForm.addEventListener('submit',function(e){if(busy){e.preventDefault();if(upNote)upNote.textContent='Wait for compression to finish, then upload.'}});
  }
})();
</script>`)}
</section>`, '/media');
});

/* ------------------------------------------------------------ picker API */
/**
 * JSON endpoints behind the media-picker dialog. The dialog is used from the
 * post editor (featured image, insert image) and later the page hero, so it
 * speaks JSON and never navigates away from what you are writing.
 */
media.get('/media/picker', async (c) => {
  const q = (c.req.query('q') || '').trim().slice(0, 80);
  const type = c.req.query('type') === 'all' ? '' : " AND m.mime LIKE 'image/%'";
  const args: (string | number)[] = [];
  let where = `m.site_id=1${type}`;
  if (q) {
    where += ' AND (instr(lower(m.filename),lower(?))>0 OR instr(lower(m.alt),lower(?))>0)';
    args.push(q, q);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.r2_key, m.filename, m.alt, m.mime FROM media m WHERE ${where} ORDER BY m.id DESC LIMIT 60`,
  ).bind(...args).all<{ id: number; r2_key: string; filename: string; alt: string; mime: string }>();
  return c.json(
    { items: results.map((row) => ({ id: row.id, url: mediaUrl(row.r2_key), filename: row.filename, alt: row.alt || '', mime: row.mime })) },
    200,
    { 'Cache-Control': 'no-store' },
  );
});

type UploadedItem = { id: number; url: string; filename: string; alt: string; mime: string; size: number };
type UploadResult = { item: UploadedItem } | { error: string };

/**
 * One place that stores an uploaded file and its row: extension decides the
 * Content-Type (never the browser), SVG stays admin-only, and the size limit is
 * the same on every platform. Shared by the library and the picker so a new
 * image format only has to be added to src/lib/media-types.ts.
 */
async function storeUpload(
  c: Ctx, file: File, alt: string, now: Date, folder: string, imagesOnly = false,
): Promise<UploadResult> {
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const mime = TYPES[ext];
  if (!mime) return { error: 'that file type is not allowed' };
  if (imagesOnly && !isImageMime(mime)) return { error: 'not an image' };
  if (file.size > MAX_BYTES) return { error: `larger than ${fmtSize(MAX_BYTES)}` };
  if (ADMIN_ONLY.has(ext) && !can(c.var.user, 'manage_settings')) return { error: 'only admins can upload SVG' };
  const filename = `${slugify(file.name.slice(0, dot)) || 'file'}.${ext}`;
  const key = `${folder}/${randomToken(6)}-${filename}`;
  await putFile(c.env, key, await file.arrayBuffer(), mime);
  const stored = mime.split(';')[0];
  const res = await c.env.DB.prepare(
    'INSERT INTO media (site_id,r2_key,filename,mime,size,alt,uploaded_by,created_at) VALUES (1,?,?,?,?,?,?,?)',
  ).bind(key, filename, stored, file.size, alt, c.var.user.id, now.toISOString()).run();
  return { item: { id: Number(res.meta.last_row_id), url: mediaUrl(key), filename, alt, mime: stored, size: file.size } };
}

const uploadFiles = (c: Ctx): File[] => {
  const list = c.var.form.getAll('files').filter((f): f is File => typeof f !== 'string' && f.size > 0);
  const single = c.var.form.get('file');
  if (list.length) return list;
  return single && typeof single !== 'string' && single.size > 0 ? [single] : [];
};

const uploadFolder = (now: Date): string => `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Upload from inside the picker, answering JSON so the dialog can refresh
 * itself. Takes one or many files (`files`, or a legacy single `file`), applies
 * the same alt text to the batch, and reports anything it had to skip.
 */
media.post('/media/picker/upload', async (c) => {
  const files = uploadFiles(c);
  if (!files.length) return c.json({ ok: false, error: 'Choose a file first.' }, 400);
  if (files.length > 20) return c.json({ ok: false, error: 'Upload up to 20 images at a time.' }, 400);
  const alt = String(c.var.form.get('alt') ?? '').trim().slice(0, 200);
  const now = new Date();
  const folder = uploadFolder(now);
  const items: UploadedItem[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    // One bad file (storage full, a truncated upload) must not sink the batch.
    try {
      const result = await storeUpload(c, file, alt, now, folder, true);
      if ('error' in result) skipped.push(`${file.name} (${result.error})`);
      else items.push(result.item);
    } catch {
      skipped.push(`${file.name} (could not be saved)`);
    }
  }
  if (!items.length) {
    return c.json({ ok: false, error: `Could not upload ${skipped.join(', ')}.`, skipped }, 415, { 'Cache-Control': 'no-store' });
  }
  return c.json({
    ok: true,
    item: items[0],
    items,
    ...(skipped.length ? { skipped } : {}),
  }, 200, { 'Cache-Control': 'no-store' });
});

/** Alt text, edited from the library list without opening anything. */
media.post('/media/:id{[0-9]+}/alt', async (c) => {
  const id = Number(c.req.param('id'));
  const alt = String(c.var.form.get('alt') ?? '').trim().slice(0, 200);
  const row = await c.env.DB.prepare('SELECT uploaded_by FROM media WHERE id=? AND site_id=1').bind(id).first<{ uploaded_by: number | null }>();
  if (!row) return errorPage(c, 404, 'That file is not in the library.');
  if (!can(c.var.user, 'manage_media') && row.uploaded_by !== c.var.user.id) return errorPage(c, 403, 'You can only edit files you uploaded.');
  await c.env.DB.prepare('UPDATE media SET alt=? WHERE id=?').bind(alt, id).run();
  return go(c, '/media', { ok: alt ? 'Alt text saved.' : 'Alt text cleared (the image is now decorative).' });
});

media.post('/media/upload', async (c) => {
  const files = uploadFiles(c);
  if (!files.length) return go(c, '/media', { err: 'Choose at least one file.' });
  const now = new Date();
  const folder = uploadFolder(now);
  const skipped: string[] = [];
  let saved = 0;
  for (const file of files.slice(0, 20)) {
    try {
      const result = await storeUpload(c, file, '', now, folder);
      if ('error' in result) skipped.push(`${file.name} (${result.error})`);
      else saved++;
    } catch {
      skipped.push(`${file.name} (could not be saved)`);
    }
  }
  if (skipped.length) return go(c, '/media', { err: `${saved} uploaded. Skipped: ${skipped.join(', ').slice(0, 300)}` });
  return go(c, '/media', { ok: `${saved} file${saved === 1 ? '' : 's'} uploaded.` });
});

media.post('/media/bulk', async (c) => {
  const state = mediaListState(c);
  const rawIds = c.var.form.getAll('ids').map((value) => Number(value));
  const ids = [...new Set(rawIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const limited = ids.length > 100;
  ids.length = Math.min(ids.length, 100);
  if (!ids.length) return mediaListRedirect(c, state, 'Select at least one media file.', true);

  const canDeleteAll = can(c.var.user, 'manage_media');
  const ownerSql = canDeleteAll ? '' : ' AND uploaded_by=?';
  const ownerArgs = canDeleteAll ? [] : [c.var.user.id];
  const placeholders = ids.map(() => '?').join(',');
  const selected = await c.env.DB.prepare(
    `SELECT id, r2_key FROM media WHERE site_id=1 AND id IN (${placeholders})${ownerSql}`,
  ).bind(...ids, ...ownerArgs).all<{ id: number; r2_key: string }>();
  if (!selected.results.length) return mediaListRedirect(c, state, 'No selected files can be deleted.', true);

  for (const item of selected.results) await deleteFile(c.env, item.r2_key);
  const statements = selected.results.flatMap((item) => [
    c.env.DB.prepare('UPDATE content SET featured_media_id=NULL WHERE featured_media_id=?').bind(item.id),
    c.env.DB.prepare('DELETE FROM media WHERE id=? AND site_id=1').bind(item.id),
  ]);
  await c.env.DB.batch(statements);
  await bumpCache(c.env, c.var.cfg);
  return mediaListRedirect(c, state, `${selected.results.length} file${selected.results.length === 1 ? '' : 's'} deleted${limited ? ' (the first 100 selected were processed)' : ''}.`);
});

media.post('/media/:id{[0-9]+}/delete', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT r2_key, uploaded_by FROM media WHERE id=? AND site_id=1').bind(id).first<{ r2_key: string; uploaded_by: number | null }>();
  if (!row) return errorPage(c, 404, 'File not found.');
  if (!can(c.var.user, 'manage_media') && row.uploaded_by !== c.var.user.id) return errorPage(c, 403, 'You can only delete your own uploads.');
  await deleteFile(c.env, row.r2_key);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE content SET featured_media_id=NULL WHERE featured_media_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM media WHERE id=?').bind(id),
  ]);
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/media', { ok: 'File deleted.' });
});

export default media;
