import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { bumpCache } from '../../lib/config';
import { slugify } from '../../lib/security';
import { csrfField, errorPage, go, html, layout } from '../../lib/ui';

/**
 * Categories and tags: rename, delete and add. Terms are shared by all posts
 * and appear on /category/{slug} and /tag/{slug}.
 */
const terms = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'editor')) return errorPage(c, 403, 'Your role cannot manage categories and tags.');
  await next();
};
terms.use('/terms', guard);
terms.use('/terms/*', guard);

type Taxonomy = 'category' | 'tag';
const taxonomyOf = (c: Ctx): Taxonomy => (c.req.query('taxonomy') === 'tag' ? 'tag' : 'category');

terms.get('/terms', async (c) => {
  const taxonomy = taxonomyOf(c);
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.slug,
            (SELECT COUNT(*) FROM content_terms ct WHERE ct.term_id=t.id) AS uses
     FROM terms t WHERE t.site_id=1 AND t.taxonomy=? ORDER BY t.name COLLATE NOCASE`,
  ).bind(taxonomy).all<{ id: number; name: string; slug: string; uses: number }>();
  const base = c.var.base;
  const label = taxonomy === 'category' ? 'Categories' : 'Tags';
  const other: Taxonomy = taxonomy === 'category' ? 'tag' : 'category';
  return layout(c, label, html`
<div class="row between" style="margin-bottom:1rem">
  <h1 style="margin:0">${label}</h1>
  <a class="btn ghost" href="${base}/terms?taxonomy=${other}">${other === 'category' ? 'Categories' : 'Tags'}</a>
</div>
<form method="post" action="${base}/terms/new" class="card">
  ${csrfField(c)}
  <input type="hidden" name="taxonomy" value="${taxonomy}">
  <label for="name" style="margin-top:0">Add a ${taxonomy}</label>
  <div class="row">
    <input type="text" id="name" name="name" required maxlength="60" placeholder="${taxonomy === 'category' ? 'Guides' : 'how-to'}" class="grow">
    <button class="btn" type="submit">Add</button>
  </div>
  <p class="hint">Posts can also create ${label.toLowerCase()} by typing them in the editor.</p>
</form>
<div class="card">
  ${results.length ? html`<table class="table">
    <thead><tr><th>Name</th><th>Slug</th><th>Posts</th><th></th></tr></thead>
    <tbody>
      ${results.map((t) => html`<tr>
        <td>
          <form method="post" action="${base}/terms/${t.id}/rename" class="row" style="gap:.4rem">
            ${csrfField(c)}<input type="hidden" name="taxonomy" value="${taxonomy}">
            <input type="text" name="name" value="${t.name}" required maxlength="60" aria-label="Name" class="grow">
            <button class="btn ghost small" type="submit">Rename</button>
          </form>
        </td>
        <td><a href="/${taxonomy}/${t.slug}" target="_blank" rel="noopener" class="muted">/${taxonomy}/${t.slug}</a></td>
        <td>${t.uses}</td>
        <td class="actions">
          <form method="post" action="${base}/terms/${t.id}/delete" class="inline" data-confirm>
            ${csrfField(c)}<input type="hidden" name="taxonomy" value="${taxonomy}">
            <button class="btn danger small" type="submit">Delete</button>
          </form>
        </td>
      </tr>`)}
    </tbody>
  </table>` : html`<p class="muted" style="margin:0">No ${label.toLowerCase()} yet.</p>`}
</div>`, '/terms');
});

terms.post('/terms/new', async (c) => {
  const taxonomy = c.var.form.get('taxonomy') === 'tag' ? 'tag' : 'category';
  const name = String(c.var.form.get('name') ?? '').trim().slice(0, 60);
  const slug = slugify(name);
  if (!name || !slug) return go(c, `/terms?taxonomy=${taxonomy}`, { err: 'Enter a name.' });
  const exists = await c.env.DB.prepare('SELECT 1 AS x FROM terms WHERE site_id=1 AND taxonomy=? AND slug=?').bind(taxonomy, slug).first();
  if (exists) return go(c, `/terms?taxonomy=${taxonomy}`, { err: `"${name}" already exists.` });
  await c.env.DB.prepare('INSERT INTO terms (site_id,taxonomy,name,slug) VALUES (1,?,?,?)').bind(taxonomy, name, slug).run();
  await bumpCache(c.env, c.var.cfg);
  return go(c, `/terms?taxonomy=${taxonomy}`, { ok: `${name} added.` });
});

terms.post('/terms/:id{[0-9]+}/rename', async (c) => {
  const id = Number(c.req.param('id'));
  const taxonomy: Taxonomy = c.var.form.get('taxonomy') === 'tag' ? 'tag' : 'category';
  const name = String(c.var.form.get('name') ?? '').trim().slice(0, 60);
  const slug = slugify(name);
  const row = await c.env.DB.prepare('SELECT id, taxonomy FROM terms WHERE id=? AND site_id=1').bind(id)
    .first<{ id: number; taxonomy: string }>();
  if (!row) return errorPage(c, 404, 'Term not found.');
  if (!name || !slug) return go(c, `/terms?taxonomy=${taxonomy}`, { err: 'Enter a name.' });
  const clash = await c.env.DB.prepare('SELECT 1 AS x FROM terms WHERE site_id=1 AND taxonomy=? AND slug=? AND id<>?')
    .bind(row.taxonomy, slug, id).first();
  if (clash) return go(c, `/terms?taxonomy=${taxonomy}`, { err: 'Another term already uses that name.' });
  await c.env.DB.prepare('UPDATE terms SET name=?, slug=? WHERE id=?').bind(name, slug, id).run();
  await bumpCache(c.env, c.var.cfg);
  return go(c, `/terms?taxonomy=${taxonomy}`, { ok: 'Renamed.' });
});

terms.post('/terms/:id{[0-9]+}/delete', async (c) => {
  const id = Number(c.req.param('id'));
  const taxonomy: Taxonomy = c.var.form.get('taxonomy') === 'tag' ? 'tag' : 'category';
  const row = await c.env.DB.prepare('SELECT name FROM terms WHERE id=? AND site_id=1').bind(id).first<{ name: string }>();
  if (!row) return errorPage(c, 404, 'Term not found.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM content_terms WHERE term_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM terms WHERE id=?').bind(id),
  ]);
  await bumpCache(c.env, c.var.cfg);
  return go(c, `/terms?taxonomy=${taxonomy}`, { ok: `"${row.name}" deleted.` });
});

export default terms;
