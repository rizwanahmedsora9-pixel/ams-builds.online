import type { Env } from '../types';
import { hasColumn } from './schema';
import { mediaUrl } from './content';

/** Maximum permitted depth, counting a top-level page as depth zero. */
export const MAX_PAGE_DEPTH = 12;

export type PageHierarchyRow = {
  id: number;
  title: string;
  slug: string;
  parent_id: number | null;
  status: string;
  menu_order: number;
  icon?: string;
  excerpt?: string;
  media_key?: string | null;
};

export type PageHierarchyLink = {
  id: number;
  title: string;
  slug: string;
  url: string;
  excerpt?: string;
  image?: string;
  icon?: string;
};

export type PublicPageHierarchy = {
  current: PageHierarchyLink | null;
  ancestors: PageHierarchyLink[];
  children: PageHierarchyLink[];
};

/** A stable order for siblings: their saved page order, then title. */
export function comparePageOrder(a: PageHierarchyRow, b: PageHierarchyRow): number {
  return a.menu_order - b.menu_order || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id - b.id;
}

/** Returns a map of every descendant (including `rootId` itself). */
export function pageDescendants(rootId: number, pages: PageHierarchyRow[]): Set<number> {
  const children = new Map<number, number[]>();
  for (const page of pages) {
    if (page.parent_id == null) continue;
    const siblings = children.get(page.parent_id) ?? [];
    siblings.push(page.id);
    children.set(page.parent_id, siblings);
  }
  const found = new Set<number>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const id of children.get(current) ?? []) {
      if (found.has(id)) continue;
      found.add(id);
      queue.push(id);
    }
  }
  return found;
}

/** Page depth from the root; cycles are treated as deeper than the allowed limit. */
export function pageDepth(id: number, pagesById: Map<number, PageHierarchyRow>): number {
  let depth = 0;
  let cursor = pagesById.get(id);
  const seen = new Set<number>();
  while (cursor?.parent_id != null) {
    if (seen.has(cursor.id) || depth > MAX_PAGE_DEPTH) return MAX_PAGE_DEPTH + 1;
    seen.add(cursor.id);
    depth++;
    cursor = pagesById.get(cursor.parent_id);
  }
  return depth;
}

/** Height below a page, including grandchildren; cycle-safe for imported data. */
export function pageSubtreeHeight(rootId: number, pages: PageHierarchyRow[]): number {
  const children = new Map<number, number[]>();
  for (const page of pages) {
    if (page.parent_id == null) continue;
    const siblings = children.get(page.parent_id) ?? [];
    siblings.push(page.id);
    children.set(page.parent_id, siblings);
  }
  let height = 0;
  const queue: [number, number][] = [[rootId, 0]];
  const seen = new Set<number>([rootId]);
  while (queue.length) {
    const [id, depth] = queue.shift()!;
    height = Math.max(height, depth);
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push([child, depth + 1]);
    }
  }
  return height;
}

/** Flatten a hierarchy in tree order for the parent-page select. */
export function orderedPageTree(pages: PageHierarchyRow[]): { page: PageHierarchyRow; depth: number }[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const children = new Map<number, PageHierarchyRow[]>();
  for (const page of pages) {
    if (page.parent_id == null || !byId.has(page.parent_id)) continue;
    const siblings = children.get(page.parent_id) ?? [];
    siblings.push(page);
    children.set(page.parent_id, siblings);
  }
  for (const siblings of children.values()) siblings.sort(comparePageOrder);

  const rows: { page: PageHierarchyRow; depth: number }[] = [];
  const seen = new Set<number>();
  const visit = (page: PageHierarchyRow, depth: number) => {
    if (seen.has(page.id)) return;
    seen.add(page.id);
    rows.push({ page, depth });
    for (const child of children.get(page.id) ?? []) visit(child, depth + 1);
  };
  const roots = pages
    .filter((page) => page.parent_id == null || !byId.has(page.parent_id))
    .sort(comparePageOrder);
  for (const root of roots) visit(root, 0);
  // If a bad import left a cycle, still expose every page in the panel instead
  // of hiding the cyclic branch. Saving the page again can repair its parent.
  for (const page of [...pages].sort(comparePageOrder)) if (!seen.has(page.id)) visit(page, 0);
  return rows;
}

/**
 * Published children and published ancestors for the public page directory.
 * Page URLs intentionally remain the existing flat /slug URLs; changing a
 * parent therefore never breaks a visitor's bookmarks or links.
 */
export async function publicPageHierarchy(
  env: Env,
  pageId: number,
  homePageId: string | undefined,
): Promise<PublicPageHierarchy> {
  if (!(await hasColumn(env, 'content', 'parent_id'))) return { current: null, ancestors: [], children: [] };
  const hasIcon = await hasColumn(env, 'content', 'icon');
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.title, c.slug, c.parent_id, c.status, COALESCE(c.menu_order,0) AS menu_order, c.excerpt, ${hasIcon ? "c.icon" : "'' AS icon"}, m.r2_key AS media_key FROM content c LEFT JOIN media m ON m.id=c.featured_media_id AND m.site_id=c.site_id AND m.mime LIKE 'image/%' WHERE c.site_id=1 AND c.type='page'`,
  ).all<PageHierarchyRow>();
  const byId = new Map(results.map((page) => [page.id, page]));
  const current = byId.get(pageId);
  if (!current) return { current: null, ancestors: [], children: [] };

  const link = (page: PageHierarchyRow): PageHierarchyLink => ({
    id: page.id,
    title: page.title,
    slug: page.slug,
    url: homePageId === String(page.id) ? '/' : '/' + page.slug,
    excerpt: page.excerpt || '', image: page.media_key ? mediaUrl(page.media_key) : '', icon: page.icon,
  });
  const ancestors: PageHierarchyLink[] = [];
  const seen = new Set<number>([pageId]);
  let parentId = current.parent_id;
  while (parentId != null && ancestors.length < MAX_PAGE_DEPTH) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = byId.get(parentId);
    // Do not reveal or link to an unpublished page in the public breadcrumb.
    if (!parent || parent.status !== 'published') break;
    ancestors.unshift(link(parent));
    parentId = parent.parent_id;
  }

  const children = results
    .filter((page) => page.parent_id === pageId && page.status === 'published')
    .sort(comparePageOrder)
    .map(link);
  return { current: link(current), ancestors, children };
}
