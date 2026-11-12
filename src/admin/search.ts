/**
 * Global search and command registry.
 *
 * One function searches everything a signed-in user can see; the same result
 * feeds the no-JavaScript /search page and the ⌘K palette (which fetches the
 * `partial=1` version and swaps it in). Nothing here renders HTML, so both
 * callers decide how to present it.
 */
import type { Env, User } from '../types';
import { can } from '../lib/auth';

export type Hit = { label: string; sub?: string; href: string; icon: string; badge?: string };
export type Group = { title: string; hits: Hit[] };

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 80;

/** A palette command: something to *do*, not something found. */
export type Command = { label: string; href: string; icon: string; keys: string[]; group: string };

/** Static commands, filtered by role. Rendered into the palette by the client. */
export function commandsFor(base: string, user: User): Command[] {
  const admin = can(user, 'admin');
  const editor = can(user, 'editor');
  const list: Command[] = [
    { label: 'New post', href: `${base}/posts/new`, icon: 'plus', keys: ['new', 'post', 'write', 'add'], group: 'Create' },
    { label: 'New page', href: `${base}/pages/new`, icon: 'plus', keys: ['new', 'page', 'add'], group: 'Create' },
    { label: 'Upload media', href: `${base}/media#upload`, icon: 'upload', keys: ['media', 'upload', 'image', 'file'], group: 'Create' },
    { label: 'All posts', href: `${base}/posts`, icon: 'pin', keys: ['posts', 'list', 'blog'], group: 'Go to' },
    { label: 'All pages', href: `${base}/pages`, icon: 'file', keys: ['pages'], group: 'Go to' },
    { label: 'Media library', href: `${base}/media`, icon: 'image', keys: ['media', 'library', 'files'], group: 'Go to' },
    { label: 'Comments', href: `${base}/comments`, icon: 'message', keys: ['comments', 'moderate', 'spam'], group: 'Go to' },
    { label: 'Categories', href: `${base}/terms?taxonomy=category`, icon: 'list', keys: ['categories', 'terms', 'taxonomy'], group: 'Go to' },
    { label: 'Tags', href: `${base}/terms?taxonomy=tag`, icon: 'list', keys: ['tags', 'terms', 'taxonomy'], group: 'Go to' },
    { label: 'Preferences', href: `${base}/preferences`, icon: 'settings', keys: ['preferences', 'theme', 'dark', 'density', 'appearance'], group: 'Go to' },
    { label: 'Your profile', href: `${base}/profile`, icon: 'user', keys: ['profile', 'password', 'email', 'account'], group: 'Go to' },
    { label: 'View the site', href: '/', icon: 'external', keys: ['site', 'view', 'front'], group: 'Go to' },
  ];
  if (editor) {
    list.push(
      { label: 'Appearance', href: `${base}/appearance`, icon: 'palette', keys: ['appearance', 'customize', 'css', 'code'], group: 'Go to' },
      { label: 'Menus', href: `${base}/menus`, icon: 'list', keys: ['menus', 'navigation', 'links'], group: 'Go to' },
    );
  }
  if (admin) {
    list.push(
      { label: 'Themes', href: `${base}/themes`, icon: 'palette', keys: ['themes', 'theme', 'design', 'store'], group: 'Go to' },
      { label: 'Widgets', href: `${base}/widgets`, icon: 'grid', keys: ['widgets', 'footer'], group: 'Go to' },
      { label: 'Plugins', href: `${base}/plugins`, icon: 'plug', keys: ['plugins', 'snippets', 'code'], group: 'Go to' },
      { label: 'Users', href: `${base}/users`, icon: 'users', keys: ['users', 'accounts', 'roles', 'people'], group: 'Go to' },
      { label: 'Settings', href: `${base}/settings`, icon: 'settings', keys: ['settings', 'title', 'tagline', 'timezone', 'permalink', 'domain'], group: 'Go to' },
      { label: 'Updates', href: `${base}/updates`, icon: 'refresh', keys: ['updates', 'migrations', 'version'], group: 'Go to' },
      { label: 'Redirects', href: `${base}/tools/redirects`, icon: 'refresh', keys: ['redirects', 'redirect', '301'], group: 'Go to' },
      { label: 'Import / Export', href: `${base}/tools/export`, icon: 'download', keys: ['export', 'import', 'backup', 'json'], group: 'Go to' },
      { label: 'Backups', href: `${base}/tools/backups`, icon: 'download', keys: ['backups', 'snapshot'], group: 'Go to' },
      { label: 'Site Health', href: `${base}/tools/health`, icon: 'tools', keys: ['health', 'diagnostics', 'status'], group: 'Go to' },
    );
  }
  return list;
}

const like = (q: string): string => `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
const oneLine = (text: string, max = 90): string => {
  const flat = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
};

/**
 * Searches content, media, comments, terms and users. Every query is scoped to
 * what the signed-in role may see: authors only find their own posts.
 */
export async function searchSite(env: Env, user: User, rawQuery: string): Promise<Group[]> {
  const q = rawQuery.trim().slice(0, SEARCH_MAX);
  if (q.length < SEARCH_MIN) return [];
  const pattern = like(q.toLowerCase());
  const editor = can(user, 'editor');
  const admin = can(user, 'admin');
  const groups: Group[] = [];

  // Posts and pages ---------------------------------------------------------
  const contentArgs: unknown[] = [pattern, pattern, pattern, pattern];
  let contentSql = `SELECT c.id, c.type, c.title, c.status, c.excerpt, c.body, c.published_at, c.updated_at
    FROM content c WHERE c.site_id=1
      AND (lower(c.title) LIKE ? ESCAPE '\\' OR lower(c.body) LIKE ? ESCAPE '\\'
           OR lower(c.excerpt) LIKE ? ESCAPE '\\' OR lower(c.slug) LIKE ? ESCAPE '\\')`;
  if (!editor) {
    contentSql += ' AND c.author_id=?';
    contentArgs.push(user.id);
  }
  contentSql += ' ORDER BY (lower(c.title) LIKE ?) DESC, c.updated_at DESC LIMIT 6';
  const contentRows = (await env.DB.prepare(contentSql).bind(...contentArgs, `%${q.toLowerCase()}%`).all<{
    id: number; type: 'post' | 'page'; title: string; status: string; excerpt: string; body: string;
  }>()).results;
  if (contentRows.length) {
    groups.push({
      title: 'Posts and pages',
      hits: contentRows.map((row) => ({
        label: row.title || '(untitled)',
        sub: [row.type, row.status, oneLine(row.excerpt || row.body)].filter(Boolean).join(' · '),
        href: `${row.type === 'page' ? 'pages' : 'posts'}/${row.id}`,
        icon: row.type === 'page' ? 'file' : 'pin',
        badge: row.status,
      })),
    });
  }

  // Media -------------------------------------------------------------------
  const mediaRows = (await env.DB.prepare(
    `SELECT id, filename, mime FROM media WHERE site_id=1 AND lower(filename) LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 4`,
  ).bind(pattern).all<{ id: number; filename: string; mime: string }>()).results;
  if (mediaRows.length) {
    groups.push({
      title: 'Media',
      hits: mediaRows.map((row) => ({
        label: row.filename,
        sub: row.mime,
        href: `media?q=${encodeURIComponent(row.filename)}`,
        icon: row.mime.startsWith('image/') ? 'image' : 'file',
      })),
    });
  }

  // Comments (moderators and above) -----------------------------------------
  if (editor) {
    try {
      const commentRows = (await env.DB.prepare(
        `SELECT cm.id, cm.author_name, cm.body, cm.status, c.title AS post
         FROM comments cm LEFT JOIN content c ON c.id=cm.content_id
         WHERE cm.site_id=1 AND (lower(cm.body) LIKE ? ESCAPE '\\' OR lower(cm.author_name) LIKE ? ESCAPE '\\')
         ORDER BY cm.created_at DESC LIMIT 4`,
      ).bind(pattern, pattern).all<{ id: number; author_name: string; body: string; status: string; post: string }>()).results;
      if (commentRows.length) {
        groups.push({
          title: 'Comments',
          hits: commentRows.map((row) => ({
            label: `${row.author_name || 'Visitor'}: ${oneLine(row.body, 60)}`,
            sub: row.post ? `on ${row.post}` : undefined,
            href: `comments?status=${row.status}#comment-${row.id}`,
            icon: 'message',
            badge: row.status,
          })),
        });
      }
    } catch { /* comments table missing on an old database */ }
  }

  // Terms -------------------------------------------------------------------
  const termRows = (await env.DB.prepare(
    `SELECT taxonomy, name FROM terms WHERE site_id=1 AND lower(name) LIKE ? ESCAPE '\\'
     ORDER BY name COLLATE NOCASE LIMIT 4`,
  ).bind(pattern).all<{ taxonomy: string; name: string }>()).results;
  if (termRows.length) {
    groups.push({
      title: 'Categories and tags',
      hits: termRows.map((row) => ({
        label: row.name,
        sub: row.taxonomy,
        href: `terms?taxonomy=${row.taxonomy}`,
        icon: 'list',
      })),
    });
  }

  // Users (admins only) -----------------------------------------------------
  if (admin) {
    const userRows = (await env.DB.prepare(
      `SELECT id, username, email, role FROM users
       WHERE lower(username) LIKE ? ESCAPE '\\' OR lower(email) LIKE ? ESCAPE '\\' ORDER BY username LIMIT 4`,
    ).bind(pattern, pattern).all<{ id: number; username: string; email: string; role: string }>()).results;
    if (userRows.length) {
      groups.push({
        title: 'Users',
        hits: userRows.map((row) => ({
          label: row.username,
          sub: `${row.email} · ${row.role}`,
          href: `users/${row.id}`,
          icon: 'user',
        })),
      });
    }
  }

  return groups;
}

/** Flat list, for the palette's arrow-key navigation order. */
export const flatten = (groups: Group[]): Hit[] => groups.flatMap((g) => g.hits);
