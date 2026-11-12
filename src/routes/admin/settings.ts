import { Hono } from 'hono';
import { audit } from '../../lib/audit';
import type { AppEnv, Ctx } from '../../types';
import { can, randomToken } from '../../lib/auth';
import { bumpCache, getSettings, saveConfig, setSettings, validAdminSlug } from '../../lib/config';
import { mediaUrl } from '../../lib/content';
import { MAX_FILE_BYTES, deleteFile, putFile } from '../../lib/files';
import { FILE_TYPES } from '../../lib/media-types';
import { parseLandingAudioIds } from '../../lib/landing';
import { LANDING_UPLOAD_JS } from '../../admin/landing-upload';
import { titleFor } from '../../lib/origin';
import { cleanDomain, safeUrl, slugify } from '../../lib/security';
import { validTimezone } from '../../lib/time';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';

const settings = new Hono<AppEnv>();

settings.use('/settings', async (c, next) => {
  if (!can(c.var.user, 'manage_settings')) return errorPage(c, 403, 'Only admins can change settings.');
  await next();
});

const COMMON_ZONES = ['UTC', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
  'Europe/London', 'Europe/Berlin', 'Europe/Istanbul', 'Africa/Cairo', 'Africa/Lagos', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Sao_Paulo'];

settings.get('/settings', async (c) => {
  const s = await getSettings(c.env);
  const cfg = c.var.cfg;
  const { results: pages } = await c.env.DB.prepare("SELECT id, title, status FROM content WHERE site_id=1 AND type='page' ORDER BY title").all<{ id: number; title: string; status: string }>();
  const { results: audioLibrary } = await c.env.DB.prepare("SELECT id, r2_key, filename, mime, size FROM media WHERE site_id=1 AND mime LIKE 'audio/%' ORDER BY id DESC").all<{ id: number; r2_key: string; filename: string; mime: string; size: number }>();
  const selectedAudioIds = parseLandingAudioIds(s.landing_audio_ids);
  const selectedSet = new Set(selectedAudioIds);
  const audioById = new Map(audioLibrary.map((item) => [item.id, item]));
  const playlist = [
    ...selectedAudioIds.map((id) => audioById.get(id)).filter((item): item is typeof audioLibrary[number] => !!item),
    ...audioLibrary.filter((item) => !selectedSet.has(item.id)),
  ];
  const audioAccept = Object.entries(FILE_TYPES).filter(([, mime]) => mime.startsWith('audio/')).map(([ext]) => '.' + ext).join(',');
  const fmtSize = (n: number) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const sel = (on: boolean) => (on ? raw(' selected') : '');
  const style = s.permalink_style || 'blog';
  const extra = cfg.domains.filter((d) => d !== cfg.primaryDomain).join('\n');
  // What visitors see right now: the stored title is still the installer's
  // guess, so the name follows the domain in the address bar instead.
  const shownTitle = titleFor(s.site_title, new URL(c.req.url));
  return layout(c, 'Settings', html`
<div class="row between" style="margin-bottom:1rem"><h1 style="margin:0">Settings</h1><a href="${c.var.base}/appearance">Customize CSS and code</a></div>
<form method="post" action="${c.var.base}/settings" enctype="multipart/form-data" id="settings-form" data-upload-endpoint="${c.var.base}/settings/landing-audio">
  ${csrfField(c)}
  <div class="card" id="site">
    <h2>Site</h2>
    <label for="site_title" style="margin-top:0">Site title</label>
    <input type="text" id="site_title" name="site_title" value="${s.site_title ?? ''}" required maxlength="120">
    <p class="hint">Shown in the browser tab, the panel header and the landing screen. Leave it as it is to follow the domain automatically (<b>${shownTitle}</b> on this address). Type a name to use it everywhere instead.</p>
    <label for="tagline">Tagline</label>
    <input type="text" id="tagline" name="tagline" value="${s.tagline ?? ''}" maxlength="200">
    <label for="favicon">Favicon URL</label>
    <input type="text" id="favicon" name="favicon" value="${s.favicon ?? ''}" placeholder="/media/2026/01/abc-icon.png">
    <p class="hint">Upload an icon in Media and paste its URL here.</p>
    <label for="timezone">Timezone</label>
    <input type="text" id="timezone" name="timezone" value="${s.timezone || 'UTC'}" list="zones" required autocapitalize="none">
    <datalist id="zones">${COMMON_ZONES.map((z) => html`<option value="${z}">`)}</datalist>
    <p class="hint">IANA name, e.g. Asia/Karachi. Used for post dates and scheduling.</p>
  </div>
  <div class="card" id="reading">
    <h2>Reading</h2>
    <label for="home_page_id" style="margin-top:0">Home page</label>
    <select id="home_page_id" name="home_page_id">
      <option value="">Latest posts only</option>
      ${pages.map((p) => html`<option value="${p.id}"${sel(String(p.id) === s.home_page_id)}>${p.title}</option>`)}
    </select>
    <label for="posts_per_page">Posts per page</label>
    <input type="number" id="posts_per_page" name="posts_per_page" value="${s.posts_per_page || '10'}" min="1" max="50" required>
    <label for="permalink_style">Post permalinks</label>
    <select id="permalink_style" name="permalink_style">
      <option value="blog"${sel(style === 'blog')}>/blog/post-name</option>
      <option value="plain"${sel(style === 'plain')}>/post-name</option>
      <option value="dated"${sel(style === 'dated')}>/2026/01/post-name</option>
    </select>
    <p class="hint">Old post URLs redirect automatically when you change this.</p>
    <label for="default_editor">Default editor</label>
    <select id="default_editor" name="default_editor">
      <option value="ask"${sel(!['classic', 'modern'].includes(s.default_editor || ''))}>Ask every time (classic or modern)</option>
      <option value="modern"${sel(s.default_editor === 'modern')}>Modern editor</option>
      <option value="classic"${sel(s.default_editor === 'classic')}>Classic editor</option>
    </select>
    <p class="hint">Every post and page can still switch between the two from the editor itself.</p>
  </div>
  <div class="card" id="landing">
    <h2>Landing soundtrack</h2>
    <p class="hint" style="margin-top:0">The music for the built-in welcome screen. <b><a href="${c.var.base}/landing">Landing page</a></b> is where the screen itself is turned on or off and its play button shown or hidden. <a href="/?landing=1" target="_blank" rel="noopener">Preview the landing screen</a> — the preview reopens it even after you have entered in this tab.</p>
    <label for="landing_audio_files">Add soundtrack files</label>
    <input type="file" id="landing_audio_files" name="landing_audio_files" accept="${audioAccept}" multiple>
    <p class="hint">MP3, OGG, WAV, M4A, AAC, FLAC or Opus. Up to 20 MB per file and 20 tracks in the playlist. Files upload as soon as you pick them, one at a time, so a slow connection only has to carry one track. Audio starts only after the visitor presses Play, then plays in order and loops.</p>
    <p class="hint landing-upload-note" id="landing-upload-note" role="status" aria-live="polite"></p>
    <div class="landing-upload-queue" id="landing-upload-queue" hidden></div>
    <noscript><p class="hint">JavaScript is off, so the files upload together with Save settings. Keep the tab open until it reloads.</p></noscript>
    <fieldset class="landing-audio-fieldset">
      <legend>Soundtrack playlist</legend>
      ${playlist.length ? html`<div class="landing-audio-list">
        ${playlist.map((item, index) => html`<div class="landing-audio-row">
          <label class="check" for="landing-audio-${item.id}">
            <input type="checkbox" id="landing-audio-${item.id}" name="landing_audio_ids" value="${item.id}"${selectedSet.has(item.id) ? raw(' checked') : ''}>
            <span><strong>${item.filename}</strong><small>${item.mime} · ${fmtSize(item.size)}</small></span>
          </label>
          <label class="landing-audio-order" for="landing-audio-order-${item.id}">Order
            <input type="number" id="landing-audio-order-${item.id}" name="landing_audio_order_${item.id}" value="${Math.min(20, index + 1)}" min="1" max="20" step="1" inputmode="numeric">
          </label>
        </div>`)}
      </div>` : html`<p class="hint">No audio files yet. Add one or more above; uploaded files are added to the playlist automatically.</p>`}
      <p class="hint">Select the tracks you want and set their order. New uploads are appended to the end of the selected playlist.</p>
    </fieldset>
  </div>
  ${raw(LANDING_UPLOAD_JS)}
  <div class="card" id="discussion">
    <h2>Discussion</h2>
    <label class="check" style="margin-top:0"><input type="checkbox" name="comments_enabled" value="1"${s.comments_enabled !== '0' ? raw(' checked') : ''}> Allow comments on posts</label>
    <label class="check"><input type="checkbox" name="comments_require_approval" value="1"${s.comments_require_approval !== '0' ? raw(' checked') : ''}> Hold new comments for moderation</label>
    <p class="hint">Visitors can comment with a name and email; the email is never published. Moderate everything under <a href="${c.var.base}/comments">Comments</a>.</p>
  </div>
  <div class="card" id="security">
    <h2>Content security policy</h2>
    <label for="csp">Policy for your public pages</label>
    <select id="csp" name="csp">
      <option value="off"${sel((s.csp || 'report') === 'off')}>Off — no policy header</option>
      <option value="report"${sel((s.csp || 'report') === 'report')}>Report only — log what would break (recommended while you check)</option>
      <option value="enforce"${sel(s.csp === 'enforce')}>Enforce — block anything not allowed</option>
    </select>
    <p class="hint">The policy allows scripts from this site and your own inline code (it carries a per-page nonce), plus images from anywhere over HTTPS. Start with <b>Report only</b>: your browser's console lists anything a theme or snippet would have blocked, and nothing breaks. Themes' JavaScript is served as a file, so it keeps working when you switch to <b>Enforce</b>.</p>
  </div>
  <div class="card" id="domains">
    <h2>Domains &amp; admin URL</h2>
    <label for="primary_domain" style="margin-top:0">Primary domain</label>
    <input type="text" id="primary_domain" name="primary_domain" value="${cfg.primaryDomain}" required autocapitalize="none">
    <label for="domains">Additional domains</label>
    <textarea id="domains" name="domains" placeholder="one per line" autocapitalize="none">${extra}</textarea>
    <p class="hint">The site answers on every hostname routed to the Worker; this list records the ones you use.</p>
    <label for="admin_slug">Admin URL slug</label>
    <input type="text" id="admin_slug" name="admin_slug" value="${cfg.adminSlug}" required pattern="[a-z0-9][a-z0-9\\-]{2,40}" autocapitalize="none">
    <p class="hint">Changing this moves the admin panel to the new address immediately.</p>
  </div>
  <p><button class="btn" type="submit">Save settings</button></p>
</form>`, '/settings');
});

async function storeLandingAudio(c: Ctx, file: File, now: Date): Promise<{ id: number; key: string }> {
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const mime = FILE_TYPES[ext];
  if (!mime || !mime.startsWith('audio/')) throw new Error(`Unsupported audio file: ${file.name}`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 20 MB.`);

  const filename = `${slugify(file.name.slice(0, dot)) || 'audio'}.${ext}`;
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const key = `${folder}/${randomToken(6)}-${filename}`;
  await putFile(c.env, key, await file.arrayBuffer(), mime);
  try {
    const result = await c.env.DB.prepare(
      'INSERT INTO media (site_id,r2_key,filename,mime,size,alt,uploaded_by,created_at) VALUES (1,?,?,?,?,?,?,?)',
    ).bind(key, filename, mime.split(';')[0], file.size, '', c.var.user.id, now.toISOString()).run();
    return { id: Number(result.meta.last_row_id), key };
  } catch (error) {
    await deleteFile(c.env, key).catch(() => {});
    throw error;
  }
}

/**
 * One soundtrack file per request, from the Settings screen's queue. The name
 * arrives in the multipart headers, so the extension check runs before a single
 * byte is written; a refused file answers JSON instead of a redirect, so the
 * page can say which track failed and why.
 */
settings.post('/settings/landing-audio', async (c) => {
  const files = [
    ...c.var.form.getAll('audio'),
    ...c.var.form.getAll('landing_audio_files'),
  ].filter((value): value is File => typeof value !== 'string' && value.size > 0);
  if (!files.length) return c.json({ ok: false, error: 'Choose an audio file first.' }, 400, { 'Cache-Control': 'no-store' });
  if (files.length > 1) return c.json({ ok: false, error: 'Upload one track per request.' }, 400, { 'Cache-Control': 'no-store' });

  let stored: { id: number; key: string };
  try {
    stored = await storeLandingAudio(c, files[0], new Date());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save that file.';
    return c.json({ ok: false, error: message.slice(0, 200) }, 415, { 'Cache-Control': 'no-store' });
  }

  // Straight into the selected playlist: a visitor hears the new track without
  // a second trip to Settings.
  const settingsRow = await getSettings(c.env);
  const ids = parseLandingAudioIds(settingsRow.landing_audio_ids);
  if (!ids.includes(stored.id)) ids.push(stored.id);
  await setSettings(c.env, { landing_audio_ids: JSON.stringify(ids.slice(0, 20)) });
  await bumpCache(c.env);
  const { results } = await c.env.DB.prepare('SELECT filename, mime, size FROM media WHERE id=? AND site_id=1')
    .bind(stored.id).all<{ filename: string; mime: string; size: number }>();
  return c.json({
    ok: true,
    item: { id: stored.id, url: mediaUrl(stored.key), filename: results[0]?.filename || files[0].name, mime: results[0]?.mime || 'audio/mpeg', size: results[0]?.size || files[0].size },
    tracks: ids.length,
  }, 200, { 'Cache-Control': 'no-store' });
});

settings.post('/settings', async (c) => {
  const f = c.var.form;
  const str = (k: string) => String(f.get(k) ?? '').trim();
  const cfg = c.var.cfg;

  const siteTitle = str('site_title').slice(0, 120);
  const timezone = str('timezone');
  const primary = cleanDomain(str('primary_domain'));
  const slug = str('admin_slug').toLowerCase();
  if (!siteTitle) return go(c, '/settings', { err: 'Site title is required.' });
  if (!validTimezone(timezone)) return go(c, '/settings', { err: `Unknown timezone "${timezone}".` });
  if (!primary) return go(c, '/settings', { err: 'Enter a valid primary domain.' });
  if (!validAdminSlug(slug)) return go(c, '/settings', { err: 'Admin slug: 3-41 lowercase letters, digits or dashes, and not a reserved path.' });
  if (slug !== cfg.adminSlug && (await c.env.DB.prepare("SELECT 1 AS x FROM content WHERE site_id=1 AND type='page' AND slug=?").bind(slug).first())) {
    return go(c, '/settings', { err: 'A page already uses that slug.' });
  }

  const favicon = str('favicon');
  const homeId = Number(str('home_page_id')) || 0;
  const homeOk = homeId && (await c.env.DB.prepare("SELECT 1 AS x FROM content WHERE id=? AND site_id=1 AND type='page'").bind(homeId).first());

  const submittedAudioIds = [...new Set(f.getAll('landing_audio_ids')
    .map((value) => Number(String(value)))
    .filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (submittedAudioIds.length > 20) return go(c, '/settings', { err: 'Choose no more than 20 soundtrack tracks.' });
  const audioFiles = f.getAll('landing_audio_files').filter((value): value is File => typeof value !== 'string' && value.size > 0);
  if (audioFiles.length > 20) return go(c, '/settings', { err: 'Upload no more than 20 audio files at a time.' });
  // A file this form cannot take (wrong type, too large) is left out and named in
  // the notice. Everything else in the form — the title and the playlist —
  // still saves, because losing all of it is far worse than losing a file the
  // admin can pick again.
  const refusedAudio: string[] = [];
  const acceptedAudio = audioFiles.filter((file) => {
    const dot = file.name.lastIndexOf('.');
    const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
    if (!FILE_TYPES[ext]?.startsWith('audio/')) {
      refusedAudio.push(`${file.name} is not an audio file`);
      return false;
    }
    if (file.size > MAX_FILE_BYTES) {
      refusedAudio.push(`${file.name} is larger than 20 MB`);
      return false;
    }
    return true;
  });

  const validAudioIds = new Set<number>();
  if (submittedAudioIds.length) {
    const placeholders = submittedAudioIds.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM media WHERE site_id=1 AND mime LIKE 'audio/%' AND id IN (${placeholders})`,
    ).bind(...submittedAudioIds).all<{ id: number }>();
    for (const row of results) validAudioIds.add(row.id);
  }
  const orderedAudioIds = submittedAudioIds
    .map((id, index) => {
      const value = Number(String(f.get(`landing_audio_order_${id}`) ?? ''));
      return { id, index, order: Number.isFinite(value) && value > 0 ? value : index + 1 };
    })
    .filter((item) => validAudioIds.has(item.id))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((item) => item.id);
  if (orderedAudioIds.length + acceptedAudio.length > 20) return go(c, '/settings', { err: 'The playlist can contain no more than 20 tracks.' });

  // Each file stands on its own: a storage hiccup on one track is reported and
  // the rest of the batch (and the rest of the form) still goes through.
  const addedAudio: { id: number; key: string }[] = [];
  for (const file of acceptedAudio) {
    try {
      addedAudio.push(await storeLandingAudio(c, file, new Date()));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'could not be saved';
      refusedAudio.push(`${file.name} ${message.slice(0, 160)}`);
    }
  }

  const style = ['blog', 'plain', 'dated'].includes(str('permalink_style')) ? str('permalink_style') : 'blog';
  const domains = [...new Set([primary, ...str('domains').split(/[\s,]+/).map(cleanDomain).filter(Boolean)])].slice(0, 50);

  await setSettings(c.env, {
    site_title: siteTitle,
    tagline: str('tagline').slice(0, 200),
    favicon: favicon ? safeUrl(favicon) : '',
    timezone,
    home_page_id: homeOk ? String(homeId) : '',
    landing_audio_ids: JSON.stringify([...orderedAudioIds, ...addedAudio.map((item) => item.id)]),
    posts_per_page: String(Math.min(50, Math.max(1, Number(str('posts_per_page')) || 10))),
    permalink_style: style,
    domains: domains.join('\n'),
    default_editor: ['classic', 'modern'].includes(str('default_editor')) ? str('default_editor') : 'ask',
    comments_enabled: str('comments_enabled') === '1' ? '1' : '0',
    comments_require_approval: str('comments_require_approval') === '1' ? '1' : '0',
    csp: ['off', 'report', 'enforce'].includes(str('csp')) ? str('csp') : 'report',
  });
  // Older installs may still carry the old "choose a Page" pointer. The fixed
  // screen ignores it; drop it here so exports never show a stale choice.
  await c.env.DB.prepare("DELETE FROM settings WHERE site_id=1 AND key='landing_page_id'").run();
  await c.env.DB.prepare('UPDATE sites SET hostname=?, name=? WHERE id=1').bind(primary, siteTitle).run();

  // One KV write: new config + new cache generation (every cached page is now stale).
  cfg.adminSlug = slug;
  cfg.primaryDomain = primary;
  cfg.domains = domains;
  cfg.cacheV = Date.now();
  await saveConfig(c.env, cfg);
  await audit(c, 'settings', 'setting', `Saved site settings (title “${siteTitle}”)`);
  if (refusedAudio.length) {
    return go(c, '/settings#landing', {
      err: `Settings saved, but ${refusedAudio.length === 1 ? 'one soundtrack file was' : `${refusedAudio.length} soundtrack files were`} not: ${refusedAudio.join('; ')}.`,
    });
  }
  return c.redirect(`/${slug}/settings?ok=${encodeURIComponent('Settings saved.')}`, 303);
});

export default settings;
