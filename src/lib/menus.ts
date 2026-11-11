import type { Env } from '../types';

/** Places a theme can show a menu. Themes read them as {{#each menu.primary}} / {{#each menu.footer}}. */
export const MENU_LOCATIONS: [string, string][] = [
  ['primary', 'Main menu (header)'],
  ['footer', 'Footer menu'],
];

/** The menu shown in the header; created on demand so "show in menu" always has a target. */
export async function primaryMenuId(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT id FROM menus WHERE site_id=1 AND location='primary' ORDER BY id LIMIT 1").first<{ id: number }>();
  if (row) return row.id;
  const res = await env.DB.prepare("INSERT INTO menus (site_id,name,location) VALUES (1,'Main menu','primary')").run();
  return Number(res.meta.last_row_id);
}

export async function isInPrimaryMenu(env: Env, url: string): Promise<boolean> {
  return !!(await env.DB.prepare(
    "SELECT 1 AS x FROM menu_items i JOIN menus m ON m.id=i.menu_id WHERE m.site_id=1 AND m.location='primary' AND i.url=? LIMIT 1",
  ).bind(url).first());
}

/** Keeps menus in step with a page: follows slug changes and adds/removes its main-menu link. */
export async function syncPageMenu(env: Env, p: { oldUrl: string | null; url: string; label: string; show: boolean }): Promise<void> {
  if (p.oldUrl && p.oldUrl !== p.url) {
    await env.DB.prepare('UPDATE menu_items SET url=? WHERE url=? AND menu_id IN (SELECT id FROM menus WHERE site_id=1)').bind(p.url, p.oldUrl).run();
  }
  const present = await isInPrimaryMenu(env, p.url);
  if (p.show && !present) {
    const menuId = await primaryMenuId(env);
    await env.DB.prepare('INSERT INTO menu_items (menu_id,label,url,position) SELECT ?,?,?, COALESCE(MAX(position),-1)+1 FROM menu_items WHERE menu_id=?')
      .bind(menuId, p.label.slice(0, 80), p.url, menuId).run();
  } else if (!p.show && present) {
    await env.DB.prepare("DELETE FROM menu_items WHERE url=? AND menu_id IN (SELECT id FROM menus WHERE site_id=1 AND location='primary')").bind(p.url).run();
  }
}

export async function removeUrlFromMenus(env: Env, url: string): Promise<void> {
  await env.DB.prepare('DELETE FROM menu_items WHERE url=? AND menu_id IN (SELECT id FROM menus WHERE site_id=1)').bind(url).run();
}
