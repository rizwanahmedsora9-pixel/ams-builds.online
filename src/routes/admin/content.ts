import { Hono } from 'hono';
import type { AppEnv, ContentRow, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { RESERVED_SLUGS, bumpCache, getSettings } from '../../lib/config';
import { mediaUrl, permalinkStyle, postUrl } from '../../lib/content';
import { sanitizeHtml, slugify } from '../../lib/security';
import { localToUtc, utcToLocal } from '../../lib/time';
import { isInPrimaryMenu, removeUrlFromMenus, syncPageMenu } from '../../lib/menus';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';

/** Pages and posts share one table and one editor; posts add terms, featured image and scheduling. */
const content = new Hono<AppEnv>();

type Kind = 'pages' | 'posts';
const typeOf = (kind: Kind) => (kind === 'pages' ? 'page' : 'post');
const kindOf = (c: Ctx): Kind => c.req.param('kind') as Kind;

// Pages need editor or above. Authors work on posts (their own only).
content.use('/:kind{(?:pages|posts)}/*', guard);
content.use('/:kind{(?:pages|posts)}', guard);
async function guard(c: Ctx, next: () => Promise<void>) {
  if (kindOf(c) === 'pages' && !can(c.var.user, 'editor')) return errorPage(c, 403, 'Your role cannot manage pages.');
  await next();
}
const mayEdit = (c: Ctx, row: { author_id: number | null }) => can(c.var.user, 'editor') || row.author_id === c.var.user.id;

/* -------------------------------------------------------------------- list */
content.get('/:kind{(?:pages|posts)}', async (c) => {
  const kind = kindOf(c);
  const type = typeOf(kind);
  const per = 30;
  const p = Math.max(1, Number(c.req.query('p')) || 1);
  const settings = await getSettings(c.env);
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.title, c.slug, c.status, c.updated_at, c.published_at, c.created_at, c.author_id, u.username AS author
     FROM content c LEFT JOIN users u ON u.id=c.author_id WHERE c.site_id=1 AND c.type=? ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,
  ).bind(type, per + 1, (p - 1) * per).all<ContentRow>();
  const rows = results.slice(0, per);
  const base = c.var.base;
  const label = kind === 'pages' ? 'Pages' : 'Posts';
  const style = permalinkStyle(settings);
  return layout(c, label, html`
<div class="row between" style="margin-bottom:1rem"><h1 style="margin:0">${label}</h1><a class="btn" href="${base}/${kind}/new">New ${type}</a></div>
<div class="card">
  <ul class="list">
    ${rows.map((r) => {
      const url = type === 'post' ? postUrl(r, style) : settings.home_page_id === String(r.id) ? '/' : '/' + r.slug;
      return html`<li>
        <div class="t"><a href="${base}/${kind}/${r.id}">${r.title}</a>
          <small>${url}${settings.home_page_id === String(r.id) ? ' · home page' : ''} · ${r.author || 'unknown'} · ${r.updated_at.slice(0, 10)}</small></div>
        <span class="badge ${r.status}">${r.status}</span>
        <a class="btn ghost small" href="${url}${r.status === 'published' ? '' : '?preview=1'}" target="_blank" rel="noopener">View</a>
      </li>`;
    })}
    ${rows.length ? '' : html`<li class="muted">No ${label.toLowerCase()} yet.</li>`}
  </ul>
</div>
<div class="row between">
  ${p > 1 ? html`<a class="btn ghost small" href="${base}/${kind}?p=${p - 1}">&larr; Newer</a>` : html`<span></span>`}
  ${results.length > per ? html`<a class="btn ghost small" href="${base}/${kind}?p=${p + 1}">Older &rarr;</a>` : ''}
</div>`, '/' + kind);
});

/* ------------------------------------------------------------------ editor */
const EDITOR_JS = `<script>
(function(){
  var ta=document.getElementById('body');
  document.querySelectorAll('[data-wrap]').forEach(function(b){b.addEventListener('click',function(){
    var parts=b.getAttribute('data-wrap').split('|'),open=parts[0],close=parts[1]||'';
    if(b.dataset.ask){var u=prompt(b.dataset.ask,b.dataset.def||'');if(!u)return;open=open.replace('$1',u.replace(/"/g,'&quot;'))}
    var s=ta.selectionStart,e=ta.selectionEnd,v=ta.value;
    ta.value=v.slice(0,s)+open+v.slice(s,e)+close+v.slice(e);ta.focus();ta.selectionStart=s+open.length;ta.selectionEnd=e+open.length;
  })});
  var title=document.getElementById('title'),slug=document.getElementById('slug');
  if(slug&&!slug.value){title.addEventListener('input',function(){if(slug.dataset.touched)return;
    slug.value=title.value.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)});
    slug.addEventListener('input',function(){slug.dataset.touched=1})}
  var st=document.getElementById('status'),when=document.getElementById('when');
  if(st&&when){var sync=function(){when.hidden=st.value==='draft'};st.addEventListener('change',sync);sync()}
  var del=document.getElementById('delete');if(del)del.addEventListener('submit',function(e){if(!confirm('Delete this permanently?'))e.preventDefault()});
})();
</script>`;

async function editor(c: Ctx, kind: Kind, row: ContentRow | null): Promise<Response> {
  const type = typeOf(kind);
  const base = c.var.base;
  const settings = await getSettings(c.env);
  const tz = settings.timezone || 'UTC';
  let postFields = html``;

  if (type === 'post') {
    const [terms, mine, images] = await Promise.all([
      c.env.DB.prepare('SELECT id, taxonomy, name FROM terms WHERE site_id=1 ORDER BY name').all<{ id: number; taxonomy: string; name: string }>(),
      row ? c.env.DB.prepare('SELECT term_id FROM content_terms WHERE content_id=?').bind(row.id).all<{ term_id: number }>() : null,
      c.env.DB.prepare("SELECT id, filename, r2_key FROM media WHERE site_id=1 AND mime LIKE 'image/%' ORDER BY id DESC LIMIT 200").all<{ id: number; filename: string; r2_key: string }>(),
    ]);
    const selected = new Set((mine?.results || []).map((t) => t.term_id));
    const cats = terms.results.filter((t) => t.taxonomy === 'category');
    const tags = terms.results.filter((t) => t.taxonomy === 'tag' && selected.has(t.id)).map((t) => t.name).join(', ');
    const featured = images.results.find((i) => i.id === row?.featured_media_id);
    postFields = html`
<div class="card">
  <h2>Post options</h2>
  <label for="excerpt">Excerpt</label>
  <textarea id="excerpt" name="excerpt" maxlength="500">${row?.excerpt ?? ''}</textarea>
  <p class="hint">Optional. Shown on listing pages; generated from the content when empty.</p>
  <label>Categories</label>
  ${cats.length ? html`<div class="checks">${cats.map((t) => html`<label class="check"><input type="checkbox" name="cat" value="${t.id}"${selected.has(t.id) ? raw(' checked') : ''}> ${t.name}</label>`)}</div>` : ''}
  <input type="text" name="new_cats" placeholder="Add new categories, comma separated" style="margin-top:.4rem">
  <label for="tags">Tags</label>
  <input type="text" id="tags" name="tags" value="${tags}" placeholder="news, updates">
  <label for="featured">Featured image</label>
  <select id="featured" name="featured_media_id">
    <option value="">None</option>
    ${images.results.map((i) => html`<option value="${i.id}"${i.id === row?.featured_media_id ? raw(' selected') : ''}>${i.filename}</option>`)}
  </select>
  ${featured ? html`<p><img src="${mediaUrl(featured.r2_key)}" alt="" style="max-width:12rem;border-radius:.5rem"></p>` : ''}
  <p class="hint">Upload images in <a href="${base}/media">Media</a> first.</p>
</div>`;
  }

  const status = row?.status ?? 'draft';
  // Pages: one tick puts the page in the header menu (new pages and drafts start ticked).
  const pageUrl = row ? (settings.home_page_id === String(row.id) ? '/' : '/' + row.slug) : null;
  const inMenu = type === 'page' && (!row || row.status === 'draft' || (await isInPrimaryMenu(c.env, pageUrl!)));
  const opt = (v: string, label: string) => html`<option value="${v}"${status === v ? raw(' selected') : ''}>${label}</option>`;
  const title = row ? `Edit ${type}` : `New ${type}`;
  return layout(c, title, html`
<div class="row between" style="margin-bottom:1rem"><h1 style="margin:0">${title}</h1><a href="${base}/${kind}">&larr; All ${kind}</a></div>
<form method="post" action="${base}/${kind}/save" id="edit">
  ${csrfField(c)}
  <input type="hidden" name="id" value="${row?.id ?? ''}">
  <div class="card">
    <label for="title" style="margin-top:0">Title</label>
    <input type="text" id="title" name="title" value="${row?.title ?? ''}" required maxlength="200">
    <label for="slug">Slug</label>
    <input type="text" id="slug" name="slug" value="${row?.slug ?? ''}" maxlength="80" autocapitalize="none" placeholder="generated from the title">
    <label for="body">Content (HTML)</label>
    <div class="toolbar">
      <button type="button" data-wrap="<strong>|</strong>"><b>B</b></button>
      <button type="button" data-wrap="<em>|</em>"><i>I</i></button>
      <button type="button" data-wrap="<h2>|</h2>">H2</button>
      <button type="button" data-wrap="<h3>|</h3>">H3</button>
      <button type="button" data-wrap="<p>|</p>">&para;</button>
      <button type="button" data-wrap="<ul>&#10;  <li>|</li>&#10;</ul>">List</button>
      <button type="button" data-wrap="<blockquote>|</blockquote>">Quote</button>
      <button type="button" data-wrap="<pre><code>|</code></pre>">Code</button>
      <button type="button" data-wrap='<a href="$1">|</a>' data-ask="Link URL" data-def="https://">Link</button>
      <button type="button" data-wrap='<img src="$1" alt="">|' data-ask="Image URL (copy it from Media)" data-def="/media/">Image</button>
    </div>
    <textarea id="body" name="body" class="code" spellcheck="true">${row?.body ?? ''}</textarea>
    ${can(c.var.user, 'admin') ? html`<p class="hint">As an admin your HTML is saved exactly as written.</p>` : html`<p class="hint">Scripts, styles, iframes and unsafe attributes are removed when you save.</p>`}
  </div>
  ${postFields}
  <div class="card">
    <h2>SEO</h2>
    <label for="seo_title">SEO title</label>
    <input type="text" id="seo_title" name="seo_title" value="${row?.seo_title ?? ''}" maxlength="200">
    <label for="seo_description">Meta description</label>
    <textarea id="seo_description" name="seo_description" maxlength="320">${row?.seo_description ?? ''}</textarea>
  </div>
  <div class="card">
    <h2>Publish</h2>
    <label for="status" style="margin-top:0">Status</label>
    <select id="status" name="status">
      ${opt('draft', 'Draft')}${opt('published', 'Published')}${type === 'post' ? opt('scheduled', 'Scheduled') : ''}
    </select>
    ${type === 'post' ? html`<div id="when">
      <label for="publish_at">Publish date (${tz})</label>
      <input type="datetime-local" id="publish_at" name="publish_at" value="${row?.published_at ? utcToLocal(row.published_at, tz) : ''}">
      <p class="hint">Scheduled posts go live automatically at this time. Leave empty to publish now.</p>
    </div>` : ''}
    ${type === 'page' ? html`<label class="check" style="margin-top:.9rem"><input type="checkbox" name="in_menu" value="1"${inMenu ? raw(' checked') : ''}> Show in the main menu</label>
    <p class="hint">Adds a link to this page in the site header once it is published. Reorder or rename links under <a href="${base}/menus">Menus</a>.</p>` : ''}
    <p class="row" style="margin:1.1rem 0 0"><button class="btn" type="submit">Save</button></p>
  </div>
</form>
${row ? html`<form method="post" action="${base}/${kind}/${row.id}/delete" id="delete">${csrfField(c)}<button class="btn danger" type="submit">Delete ${type}</button></form>` : ''}
${raw(EDITOR_JS)}`, '/' + kind);
}

content.get('/:kind{(?:pages|posts)}/new', (c) => editor(c, kindOf(c), null));

content.get('/:kind{(?:pages|posts)}/:id{[0-9]+}', async (c) => {
  const kind = kindOf(c);
  const row = await c.env.DB.prepare('SELECT * FROM content WHERE id=? AND type=? AND site_id=1').bind(Number(c.req.param('id')), typeOf(kind)).first<ContentRow>();
  if (!row) return errorPage(c, 404, 'Not found.');
  if (!mayEdit(c, row)) return errorPage(c, 403, 'You can only edit your own posts.');
  return editor(c, kind, row);
});

/* -------------------------------------------------------------------- save */
content.post('/:kind{(?:pages|posts)}/save', async (c) => {
  const kind = kindOf(c);
  const type = typeOf(kind);
  const f = c.var.form;
  const str = (k: string) => String(f.get(k) ?? '');
  const db = c.env.DB;
  const id = Number(str('id')) || 0;
  const now = new Date().toISOString();

  let existing: ContentRow | null = null;
  if (id) {
    existing = await db.prepare('SELECT * FROM content WHERE id=? AND type=? AND site_id=1').bind(id, type).first<ContentRow>();
    if (!existing) return errorPage(c, 404, 'Not found.');
    if (!mayEdit(c, existing)) return errorPage(c, 403, 'You can only edit your own posts.');
  }

  const title = str('title').trim().slice(0, 200) || '(untitled)';
  let slug = slugify(str('slug') || title) || `${type}-${Date.now().toString(36)}`;
  if (RESERVED_SLUGS.includes(slug) || slug === c.var.cfg.adminSlug) slug += '-' + type;
  // keep slugs unique per type: my-post, my-post-2, my-post-3 ...
  const root = slug;
  for (let n = 2; await db.prepare('SELECT 1 AS x FROM content WHERE site_id=1 AND type=? AND slug=? AND id<>?').bind(type, slug, id).first(); n++) {
    slug = `${root}-${n}`;
  }

  // Raw HTML is an admin privilege; everyone else goes through the allow-list sanitizer.
  const body = can(c.var.user, 'admin') ? str('body') : sanitizeHtml(str('body'));

  let status = ['draft', 'published', 'scheduled'].includes(str('status')) ? str('status') : 'draft';
  if (type === 'page' && status === 'scheduled') status = 'published';
  const settings = await getSettings(c.env);
  const chosen = type === 'post' && str('publish_at') ? localToUtc(str('publish_at'), settings.timezone || 'UTC') : null;
  let publishedAt = chosen ?? existing?.published_at ?? null;
  if (status === 'scheduled') {
    if (!chosen) return go(c, id ? `/${kind}/${id}` : `/${kind}/new`, { err: 'Pick a publish date to schedule this post.' });
    if (chosen <= now) status = 'published';
  } else if (status === 'published') {
    if (!publishedAt || publishedAt > now) publishedAt = now;
  }

  const featuredRaw = Number(str('featured_media_id')) || 0;
  const featured = type === 'post' && featuredRaw && (await db.prepare('SELECT 1 AS x FROM media WHERE id=? AND site_id=1').bind(featuredRaw).first()) ? featuredRaw : null;
  const excerpt = type === 'post' ? str('excerpt').trim().slice(0, 500) : '';
  const seoTitle = str('seo_title').trim().slice(0, 200);
  const seoDesc = str('seo_description').trim().slice(0, 320);

  let savedId = id;
  if (existing) {
    await db.prepare('UPDATE content SET title=?, slug=?, body=?, excerpt=?, status=?, seo_title=?, seo_description=?, featured_media_id=?, published_at=?, updated_at=? WHERE id=?')
      .bind(title, slug, body, excerpt, status, seoTitle, seoDesc, featured, publishedAt, now, id).run();
  } else {
    const res = await db.prepare('INSERT INTO content (site_id,type,title,slug,body,excerpt,status,seo_title,seo_description,featured_media_id,author_id,published_at,created_at,updated_at) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(type, title, slug, body, excerpt, status, seoTitle, seoDesc, featured, c.var.user.id, publishedAt, now, now).run();
    savedId = Number(res.meta.last_row_id);
  }

  if (type === 'post') {
    const names = (v: string) => [...new Set(v.split(',').map((s) => s.trim().slice(0, 60)).filter(Boolean))];
    const wanted: { taxonomy: string; name: string; slug: string }[] = [
      ...names(str('new_cats')).map((name) => ({ taxonomy: 'category', name, slug: slugify(name) })),
      ...names(str('tags')).map((name) => ({ taxonomy: 'tag', name, slug: slugify(name) })),
    ].filter((t) => t.slug);
    const catIds = f.getAll('cat').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
    const stmts = [
      db.prepare('DELETE FROM content_terms WHERE content_id=?').bind(savedId),
      ...wanted.map((t) => db.prepare('INSERT OR IGNORE INTO terms (site_id,taxonomy,name,slug) VALUES (1,?,?,?)').bind(t.taxonomy, t.name, t.slug)),
      ...wanted.map((t) => db.prepare('INSERT OR IGNORE INTO content_terms (content_id,term_id) SELECT ?, id FROM terms WHERE site_id=1 AND taxonomy=? AND slug=?').bind(savedId, t.taxonomy, t.slug)),
      ...catIds.map((tid) => db.prepare("INSERT OR IGNORE INTO content_terms (content_id,term_id) SELECT ?, id FROM terms WHERE id=? AND site_id=1 AND taxonomy='category'").bind(savedId, tid)),
      // drop tags nobody uses any more
      db.prepare("DELETE FROM terms WHERE taxonomy='tag' AND id NOT IN (SELECT term_id FROM content_terms)"),
    ];
    await db.batch(stmts);
  }

  if (type === 'page') {
    const isHome = settings.home_page_id === String(savedId);
    await syncPageMenu(c.env, {
      oldUrl: existing ? (isHome ? '/' : '/' + existing.slug) : null,
      url: isHome ? '/' : '/' + slug,
      label: title,
      show: str('in_menu') === '1' && status === 'published',
    });
  }

  await bumpCache(c.env, c.var.cfg);
  return go(c, `/${kind}/${savedId}`, { ok: status === 'scheduled' ? 'Saved and scheduled.' : status === 'published' ? 'Saved and published.' : 'Draft saved.' });
});

/* ------------------------------------------------------------------ delete */
content.post('/:kind{(?:pages|posts)}/:id{[0-9]+}/delete', async (c) => {
  const kind = kindOf(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT id, slug, author_id FROM content WHERE id=? AND type=? AND site_id=1').bind(id, typeOf(kind)).first<{ id: number; slug: string; author_id: number | null }>();
  if (!row) return errorPage(c, 404, 'Not found.');
  if (!mayEdit(c, row)) return errorPage(c, 403, 'You can only delete your own posts.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM content_terms WHERE content_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM content WHERE id=?').bind(id),
    c.env.DB.prepare("DELETE FROM settings WHERE site_id=1 AND key='home_page_id' AND value=?").bind(String(id)),
  ]);
  if (kind === 'pages') await removeUrlFromMenus(c.env, '/' + row.slug);
  await bumpCache(c.env, c.var.cfg);
  return go(c, `/${kind}`, { ok: 'Deleted.' });
});

export default content;
