import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { bumpCache, getSettings } from '../../lib/config';
import { MENU_LOCATIONS } from '../../lib/menus';
import { safeUrl } from '../../lib/security';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';

const menus = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'manage_menus')) return errorPage(c, 403, 'Your role cannot manage menus.');
  await next();
};
menus.use('/menus', guard);
menus.use('/menus/*', guard);

const MENU_JS = `<script>
(function(){
  function row(list,label,url){
    var li=document.getElementById('mi-template').content.firstElementChild.cloneNode(true);
    li.querySelector('[name=label]').value=label;li.querySelector('[name=url]').value=url;list.appendChild(li);
    li.querySelector('[name=label]').focus();
  }
  document.querySelectorAll('form[data-menu]').forEach(function(form){
    var list=form.querySelector('.mis');
    form.addEventListener('click',function(e){
      var b=e.target.closest('button');if(!b)return;var li=b.closest('.mi');
      if(b.hasAttribute('data-del')){li.remove()}
      else if(b.hasAttribute('data-up')){if(li.previousElementSibling)list.insertBefore(li,li.previousElementSibling)}
      else if(b.hasAttribute('data-down')){if(li.nextElementSibling)list.insertBefore(li.nextElementSibling,li)}
      else if(b.hasAttribute('data-add-page')){var s=form.querySelector('select[data-pages]'),o=s.options[s.selectedIndex];if(o&&o.value)row(list,o.getAttribute('data-label'),o.value)}
      else if(b.hasAttribute('data-add-link')){row(list,'','https://')}
    });
    // drag to reorder (mouse and touch) using the handle
    var drag=null;
    list.addEventListener('pointerdown',function(e){var h=e.target.closest('.handle');if(!h)return;drag=h.closest('.mi');drag.classList.add('dragging');h.setPointerCapture(e.pointerId);e.preventDefault()});
    list.addEventListener('pointermove',function(e){if(!drag)return;
      var el=document.elementFromPoint(e.clientX,e.clientY),over=el&&el.closest('.mi');
      if(!over||over===drag||over.parentNode!==list)return;
      var r=over.getBoundingClientRect();list.insertBefore(drag,e.clientY<r.top+r.height/2?over:over.nextSibling)});
    function end(){if(drag){drag.classList.remove('dragging');drag=null}}
    list.addEventListener('pointerup',end);list.addEventListener('pointercancel',end);
  });
  document.querySelectorAll('[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!confirm(f.getAttribute('data-confirm')))e.preventDefault()})});
})();
</script>`;

const itemRow = (label: string, url: string) => html`<li class="mi">
  <span class="handle" title="Drag to reorder" aria-hidden="true">&#8942;&#8942;</span>
  <div class="grow">
    <input type="text" name="label" value="${label}" placeholder="Label" maxlength="80" aria-label="Label">
    <input type="text" name="url" value="${url}" placeholder="/page or https://..." maxlength="500" aria-label="Link" autocapitalize="none">
  </div>
  <div class="mi-btns">
    <button type="button" data-up aria-label="Move up">&uarr;</button>
    <button type="button" data-down aria-label="Move down">&darr;</button>
    <button type="button" data-del aria-label="Remove">&times;</button>
  </div>
</li>`;

menus.get('/menus', async (c) => {
  const db = c.env.DB;
  const [menuRows, itemRows, pages, settings] = await Promise.all([
    db.prepare('SELECT id, name, location FROM menus WHERE site_id=1 ORDER BY id').all<{ id: number; name: string; location: string }>(),
    db.prepare('SELECT i.menu_id, i.label, i.url FROM menu_items i JOIN menus m ON m.id=i.menu_id WHERE m.site_id=1 ORDER BY i.position, i.id').all<{ menu_id: number; label: string; url: string }>(),
    db.prepare("SELECT id, title, slug FROM content WHERE site_id=1 AND type='page' AND status='published' ORDER BY title").all<{ id: number; title: string; slug: string }>(),
    getSettings(c.env),
  ]);
  const base = c.var.base;
  const links: [string, string][] = [
    ...pages.results.map((p): [string, string] => [settings.home_page_id === String(p.id) ? '/' : '/' + p.slug, p.title]),
    ['/blog', 'Blog'],
  ];
  return layout(c, 'Menus', html`
<h1>Menus</h1>
<p class="muted">A menu appears on the site once it is assigned to a location. Drag the dotted handle or use the arrows to reorder, then save.</p>
${menuRows.results.map((m) => html`
<div class="card">
  <form method="post" action="${base}/menus/${m.id}/save" data-menu>
    ${csrfField(c)}
    <div class="grid2">
      <div><label for="name-${m.id}" style="margin-top:0">Menu name</label><input type="text" id="name-${m.id}" name="name" value="${m.name}" required maxlength="60"></div>
      <div><label for="loc-${m.id}" style="margin-top:0">Shown in</label>
        <select id="loc-${m.id}" name="location">
          <option value="">Not shown</option>
          ${MENU_LOCATIONS.map(([v, label]) => html`<option value="${v}"${m.location === v ? raw(' selected') : ''}>${label}</option>`)}
        </select></div>
    </div>
    <label>Links</label>
    <ul class="mis">${itemRows.results.filter((i) => i.menu_id === m.id).map((i) => itemRow(i.label, i.url))}</ul>
    <div class="row" style="margin-top:.6rem">
      <select data-pages class="grow" aria-label="Page to add">${links.map(([url, label]) => html`<option value="${url}" data-label="${label}">${label} (${url})</option>`)}</select>
      <button type="button" class="btn ghost small" data-add-page>Add page</button>
      <button type="button" class="btn ghost small" data-add-link>Add custom link</button>
    </div>
    <p style="margin:1rem 0 0"><button class="btn" type="submit">Save menu</button></p>
  </form>
  <form method="post" action="${base}/menus/${m.id}/delete" data-confirm="Delete this menu?" style="margin-top:.6rem">${csrfField(c)}<button class="btn danger small" type="submit">Delete menu</button></form>
</div>`)}
${menuRows.results.length ? '' : html`<p class="muted">No menus yet.</p>`}
<form method="post" action="${base}/menus/new" class="card">
  ${csrfField(c)}
  <h2>New menu</h2>
  <div class="row"><input type="text" name="name" class="grow" placeholder="Menu name" required maxlength="60" aria-label="Menu name"><button class="btn" type="submit">Create</button></div>
</form>
<template id="mi-template">${itemRow('', '')}</template>
${raw(MENU_JS)}`, '/menus');
});

menus.post('/menus/new', async (c) => {
  const name = String(c.var.form.get('name') ?? '').trim().slice(0, 60);
  if (!name) return go(c, '/menus', { err: 'Give the menu a name.' });
  await c.env.DB.prepare("INSERT INTO menus (site_id,name,location) VALUES (1,?,'')").bind(name).run();
  return go(c, '/menus', { ok: 'Menu created. Add links and choose where it is shown.' });
});

menus.post('/menus/:id{[0-9]+}/save', async (c) => {
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  if (!(await db.prepare('SELECT 1 AS x FROM menus WHERE id=? AND site_id=1').bind(id).first())) return errorPage(c, 404, 'Menu not found.');
  const f = c.var.form;
  const name = String(f.get('name') ?? '').trim().slice(0, 60) || 'Menu';
  const wanted = String(f.get('location') ?? '');
  const location = MENU_LOCATIONS.some(([v]) => v === wanted) ? wanted : '';
  const labels = f.getAll('label').map(String);
  const urls = f.getAll('url').map(String);
  // Row order in the form is the menu order. Rows without a usable link are dropped.
  const items: { label: string; url: string }[] = [];
  let dropped = 0;
  for (let i = 0; i < Math.min(urls.length, 100); i++) {
    const rawUrl = urls[i].trim();
    const label = (labels[i] ?? '').trim().slice(0, 80);
    if (!rawUrl && !label) continue;
    const url = safeUrl(rawUrl).slice(0, 500);
    if (!url || url === 'https://' || !label) { dropped++; continue; }
    items.push({ label, url });
  }
  await db.batch([
    // a location holds one menu: taking it frees it from any other menu
    ...(location ? [db.prepare("UPDATE menus SET location='' WHERE site_id=1 AND location=? AND id<>?").bind(location, id)] : []),
    db.prepare('UPDATE menus SET name=?, location=? WHERE id=?').bind(name, location, id),
    db.prepare('DELETE FROM menu_items WHERE menu_id=?').bind(id),
    ...items.map((it, pos) => db.prepare('INSERT INTO menu_items (menu_id,label,url,position) VALUES (?,?,?,?)').bind(id, it.label, it.url, pos)),
  ]);
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/menus', dropped ? { err: `Menu saved, but ${dropped} link${dropped === 1 ? ' was' : 's were'} skipped: each needs a label and a valid link.` } : { ok: 'Menu saved.' });
});

menus.post('/menus/:id{[0-9]+}/delete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await c.env.DB.prepare('SELECT 1 AS x FROM menus WHERE id=? AND site_id=1').bind(id).first())) return errorPage(c, 404, 'Menu not found.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM menu_items WHERE menu_id=?').bind(id),
    c.env.DB.prepare('DELETE FROM menus WHERE id=?').bind(id),
  ]);
  await bumpCache(c.env, c.var.cfg);
  return go(c, '/menus', { ok: 'Menu deleted.' });
});

export default menus;
