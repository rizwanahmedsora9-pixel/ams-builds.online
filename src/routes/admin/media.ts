import { Hono } from 'hono';
import type { AppEnv } from '../../types';
import { can } from '../../lib/auth';
import { bumpCache } from '../../lib/config';
import { mediaUrl } from '../../lib/content';
import { slugify } from '../../lib/security';
import { randomToken } from '../../lib/auth';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';

const media = new Hono<AppEnv>();

const MAX_BYTES = 20 * 1024 * 1024;
// The stored Content-Type comes from this table, never from the browser.
const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  zip: 'application/zip', woff2: 'font/woff2',
};
const ADMIN_ONLY = new Set(['svg']); // can carry script; served sandboxed, but still limited to admins

const fmtSize = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

media.get('/media', async (c) => {
  const per = 48;
  const p = Math.max(1, Number(c.req.query('p')) || 1);
  const { results } = await c.env.DB.prepare('SELECT id, r2_key, filename, mime, size, uploaded_by FROM media WHERE site_id=1 ORDER BY id DESC LIMIT ? OFFSET ?')
    .bind(per + 1, (p - 1) * per).all<{ id: number; r2_key: string; filename: string; mime: string; size: number; uploaded_by: number | null }>();
  const rows = results.slice(0, per);
  const base = c.var.base;
  return layout(c, 'Media', html`
<h1>Media</h1>
<form method="post" action="${base}/media/upload" enctype="multipart/form-data" class="card">
  ${csrfField(c)}
  <label for="files" style="margin-top:0">Upload files</label>
  <input type="file" id="files" name="files" multiple required accept="${Object.keys(TYPES).map((e) => '.' + e).join(',')}">
  <p class="hint">Images, PDF, audio, video, fonts. Up to ${fmtSize(MAX_BYTES)} per file.</p>
  <p style="margin:.8rem 0 0"><button class="btn" type="submit">Upload</button></p>
</form>
<div class="media">
  ${rows.map((m) => {
    const url = mediaUrl(m.r2_key);
    const mine = can(c.var.user, 'editor') || m.uploaded_by === c.var.user.id;
    return html`<figure>
      <a class="thumb" href="${url}" target="_blank" rel="noopener">${m.mime.startsWith('image/') ? html`<img src="${url}" alt="" loading="lazy">` : (m.filename.split('.').pop() || 'file').toUpperCase()}</a>
      <figcaption>${m.filename}<br><span class="muted">${fmtSize(m.size)}</span></figcaption>
      <div class="row">
        <button type="button" class="btn ghost small" data-copy="${url}">Copy URL</button>
        ${mine ? html`<form method="post" action="${base}/media/${m.id}/delete" class="inline" data-confirm>${csrfField(c)}<button class="btn danger small" type="submit">Delete</button></form>` : ''}
      </div>
    </figure>`;
  })}
</div>
${rows.length ? '' : html`<p class="muted">No files uploaded yet.</p>`}
<div class="row between" style="margin-top:1rem">
  ${p > 1 ? html`<a class="btn ghost small" href="${base}/media?p=${p - 1}">&larr; Newer</a>` : html`<span></span>`}
  ${results.length > per ? html`<a class="btn ghost small" href="${base}/media?p=${p + 1}">Older &rarr;</a>` : ''}
</div>
${raw(`<script>
document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){
  var u=b.getAttribute('data-copy');
  (navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy URL'},1200)},function(){prompt('Copy this URL',u)})})});
document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm('Delete this file permanently?'))e.preventDefault()})});
</script>`)}`, '/media');
});

media.post('/media/upload', async (c) => {
  const files = c.var.form.getAll('files').filter((f): f is File => typeof f !== 'string' && f.size > 0);
  if (!files.length) return go(c, '/media', { err: 'Choose at least one file.' });
  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const skipped: string[] = [];
  let saved = 0;
  for (const file of files.slice(0, 20)) {
    const dot = file.name.lastIndexOf('.');
    const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
    const mime = TYPES[ext];
    if (!mime || file.size > MAX_BYTES || (ADMIN_ONLY.has(ext) && !can(c.var.user, 'admin'))) {
      skipped.push(file.name);
      continue;
    }
    const stem = slugify(file.name.slice(0, dot)) || 'file';
    const filename = `${stem}.${ext}`;
    const key = `${folder}/${randomToken(6)}-${filename}`;
    await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: mime } });
    await c.env.DB.prepare('INSERT INTO media (site_id,r2_key,filename,mime,size,uploaded_by,created_at) VALUES (1,?,?,?,?,?,?)')
      .bind(key, filename, mime.split(';')[0], file.size, c.var.user.id, now.toISOString()).run();
    saved++;
  }
  if (skipped.length) return go(c, '/media', { err: `${saved} uploaded. Skipped (type not allowed or too large): ${skipped.join(', ').slice(0, 300)}` });
  return go(c, '/media', { ok: `${saved} file${saved === 1 ? '' : 's'} uploaded.` });
});

media.post('/media/:id{[0-9]+}/delete', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT r2_key, uploaded_by FROM media WHERE id=? AND site_id=1').bind(id).first<{ r2_key: string; uploaded_by: number | null }>();
  if (!row) return errorPage(c, 404, 'File not found.');
  if (!can(c.var.user, 'editor') && row.uploaded_by !== c.var.user.id) return errorPage(c, 403, 'You can only delete your own uploads.');
  await c.env.MEDIA.delete(row.r2_key);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE content SET featured_media_id=NULL WHERE featured_media_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM media WHERE id=?').bind(id),
  ]);
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/media', { ok: 'File deleted.' });
});

export default media;
