import type { ContentRow, Env } from '../types';
import type { Settings } from './config';
import { stripTags } from './security';
import { formatDate } from './time';

/**
 * Pages for navigation (`{{#each pages}}` in a theme), in the order the editor
 * set under Pages -> Order. Falls back to alphabetical on databases that
 * predate the menu_order column.
 */
export async function listPages(env: Env, opts: { limit?: number } = {}): Promise<ContentRow[]> {
  const limit = Math.min(200, Math.max(1, opts.limit || 100));
  // Setting `pages_order` picks the default: the order set in the Pages screen
  // ('menu_order') or plain alphabetical ('title'). Themes can rely on either.
  let setting = 'menu_order';
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE site_id=1 AND key='pages_order'").first<{ value: string }>();
    if (row?.value === 'title') setting = 'title';
  } catch { /* settings table missing on a fresh install: keep the default */ }
  if (setting === 'title') {
    const { results } = await env.DB.prepare(
      `${SELECT} WHERE c.site_id=1 AND c.type='page' AND c.status='published' ORDER BY c.title COLLATE NOCASE ASC LIMIT ?`,
    ).bind(limit).all<ContentRow>();
    return results;
  }
  try {
    const { results } = await env.DB.prepare(
      `${SELECT} WHERE c.site_id=1 AND c.type='page' AND c.status='published'
       ORDER BY c.menu_order ASC, c.title COLLATE NOCASE ASC LIMIT ?`,
    ).bind(limit).all<ContentRow>();
    return results;
  } catch {
    const { results } = await env.DB.prepare(
      `${SELECT} WHERE c.site_id=1 AND c.type='page' AND c.status='published' ORDER BY c.title COLLATE NOCASE ASC LIMIT ?`,
    ).bind(limit).all<ContentRow>();
    return results;
  }
}

/** Visible to the public: published, or scheduled and already due (cron flips the status later). */
export const VISIBLE = "(c.status='published' OR (c.status='scheduled' AND c.published_at<=?))";

const SELECT = `SELECT c.*, u.username AS author, m.r2_key AS media_key, m.alt AS media_alt
  FROM content c LEFT JOIN users u ON u.id=c.author_id LEFT JOIN media m ON m.id=c.featured_media_id`;

export type PermalinkStyle = 'blog' | 'plain' | 'dated';
export const permalinkStyle = (s: Settings): PermalinkStyle =>
  s.permalink_style === 'plain' || s.permalink_style === 'dated' ? s.permalink_style : 'blog';

export function postUrl(p: { slug: string; published_at: string | null; created_at: string }, style: PermalinkStyle): string {
  if (style === 'plain') return '/' + p.slug;
  if (style === 'dated') {
    const d = p.published_at || p.created_at;
    return `/${d.slice(0, 4)}/${d.slice(5, 7)}/${p.slug}`;
  }
  return '/blog/' + p.slug;
}

export const mediaUrl = (key: string): string => '/media/' + key.split('/').map(encodeURIComponent).join('/');

export type TermView = { name: string; slug: string; url: string };
export type ContentView = {
  id: number; type: string; title: string; slug: string; url: string; content: string; excerpt: string;
  date: string; date_iso: string; author: string | null; featured_image: string | null; featured_alt: string;
  categories: TermView[]; tags: TermView[]; seo_title: string; seo_description: string; status: string;
  /** The theme template the editor chose for this item ('' = the default). */
  template: string;
};

/** Turns DB rows into the objects themes (and the JSON API) see. */
export async function toViews(env: Env, rows: ContentRow[], settings: Settings): Promise<ContentView[]> {
  const style = permalinkStyle(settings);
  const tz = settings.timezone || 'UTC';
  const terms = new Map<number, { categories: TermView[]; tags: TermView[] }>();
  const postIds = rows.filter((r) => r.type === 'post').map((r) => r.id);
  if (postIds.length) {
    const { results } = await env.DB.prepare(
      `SELECT ct.content_id, t.taxonomy, t.name, t.slug FROM content_terms ct JOIN terms t ON t.id=ct.term_id
       WHERE ct.content_id IN (${postIds.map(() => '?').join(',')}) ORDER BY t.name`,
    ).bind(...postIds).all<{ content_id: number; taxonomy: string; name: string; slug: string }>();
    for (const t of results) {
      const entry = terms.get(t.content_id) || { categories: [], tags: [] };
      const view = { name: t.name, slug: t.slug, url: `/${t.taxonomy}/${t.slug}` };
      (t.taxonomy === 'category' ? entry.categories : entry.tags).push(view);
      terms.set(t.content_id, entry);
    }
  }
  return rows.map((r) => {
    const date = r.published_at || r.created_at;
    const plain = r.excerpt || stripTags(r.body);
    return {
      id: r.id, type: r.type, title: r.title, slug: r.slug, status: r.status,
      template: r.template || '',
      url: r.type === 'post' ? postUrl(r, style) : settings.home_page_id === String(r.id) ? '/' : '/' + r.slug,
      content: r.body,
      excerpt: plain.length > 180 ? plain.slice(0, 177).trimEnd() + '…' : plain,
      date: formatDate(date, tz), date_iso: date,
      author: r.author ?? null,
      featured_image: r.media_key ? mediaUrl(r.media_key) : null,
      featured_alt: r.media_alt || '',
      categories: terms.get(r.id)?.categories || [], tags: terms.get(r.id)?.tags || [],
      seo_title: r.seo_title, seo_description: r.seo_description,
    };
  });
}

export async function findContent(
  env: Env, where: { type: 'page' | 'post'; slug?: string; id?: number }, includeHidden = false,
): Promise<ContentRow | null> {
  const cond = ['c.site_id=1', 'c.type=?'];
  const args: unknown[] = [where.type];
  if (where.slug !== undefined) { cond.push('c.slug=?'); args.push(where.slug); }
  if (where.id !== undefined) { cond.push('c.id=?'); args.push(where.id); }
  if (!includeHidden) { cond.push(VISIBLE); args.push(new Date().toISOString()); }
  return env.DB.prepare(`${SELECT} WHERE ${cond.join(' AND ')} LIMIT 1`).bind(...args).first<ContentRow>();
}

export async function listPosts(
  env: Env, opts: { page: number; perPage: number; termId?: number },
): Promise<{ rows: ContentRow[]; total: number }> {
  const now = new Date().toISOString();
  const join = opts.termId ? ' JOIN content_terms ct ON ct.content_id=c.id AND ct.term_id=?' : '';
  const where = ` WHERE c.site_id=1 AND c.type='post' AND ${VISIBLE}`;
  const args: unknown[] = opts.termId ? [opts.termId, now] : [now];
  const [list, count] = await env.DB.batch<any>([
    env.DB.prepare(`${SELECT}${join}${where} ORDER BY c.published_at DESC, c.id DESC LIMIT ? OFFSET ?`).bind(...args, opts.perPage, (opts.page - 1) * opts.perPage),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM content c${join}${where}`).bind(...args),
  ]);
  return { rows: list.results as ContentRow[], total: Number(count.results[0]?.n || 0) };
}

/** Promotes scheduled posts whose time has come. Returns how many changed. */
export async function publishDue(env: Env): Promise<number> {
  const res = await env.DB.prepare("UPDATE content SET status='published' WHERE status='scheduled' AND published_at<=?")
    .bind(new Date().toISOString()).run();
  return res.meta.changes || 0;
}
