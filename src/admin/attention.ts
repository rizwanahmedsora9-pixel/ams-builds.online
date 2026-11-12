/**
 * "Needs attention" - the answers a person running the site actually wants on
 * the dashboard, in priority order: things that are broken or overdue first,
 * then things waiting for a decision, then work in progress.
 *
 * Every check is independent and fails soft: on an old database (no comments
 * table yet) or a missing media bucket the item simply disappears instead of
 * taking the dashboard down. Each item carries the link that fixes it, so the
 * dashboard is a to-do list, not a report.
 */
import type { Ctx, User } from '../types';
import { can } from '../lib/auth';
import { SCHEMA_VERSION, installedSchemaVersion } from '../db/migrations';

export type AttentionTone = 'danger' | 'warn' | 'info';

export type AttentionItem = {
  /** Stable key, used for the DOM id and for tests. */
  key: string;
  tone: AttentionTone;
  /** Short, count-shaped title, e.g. "3 comments waiting". */
  title: string;
  /** One sentence: why it matters or what happens when it is ignored. */
  body: string;
  href: string;
  cta: string;
  /** How many things this item is about; 0 means the item is filtered out. */
  count: number;
};

type Row = Record<string, number | string | null>;

const n = (row: Row | null, key: string): number => Number(row?.[key] ?? 0) || 0;

function dateOnly(iso: string | null | undefined): string {
  return (iso || '').slice(0, 10);
}

async function tryFirst<T extends Row>(c: Ctx, sql: string, ...args: (string | number)[]): Promise<T | null> {
  try {
    return await c.env.DB.prepare(sql).bind(...args).first<T>();
  } catch {
    return null;
  }
}

/**
 * Collect the dashboard items for this user. Role-scoped: an author is never
 * told about comments they cannot see, users or database updates.
 */
export async function needsAttention(c: Ctx, base: string): Promise<{ items: AttentionItem[]; checked: number }> {
  const user: User = c.var.user;
  const editor = can(user, 'editor');
  const admin = can(user, 'admin');
  const items: AttentionItem[] = [];

  const [pending, failed, scheduled, stale, unindexed, unreadable, migrations, authors] = await Promise.all([
    // Comments waiting for moderation.
    editor
      ? tryFirst<Row>(c, "SELECT COUNT(*) AS n FROM comments WHERE site_id=1 AND status='pending'")
      : Promise.resolve(null),
    // Comments a spam filter rejected: usually a false positive worth a look.
    editor
      ? tryFirst<Row>(c, "SELECT COUNT(*) AS n FROM comments WHERE site_id=1 AND status='spam'")
      : Promise.resolve(null),
    // Posts whose scheduled time has already passed.
    tryFirst<Row>(
      c,
      "SELECT COUNT(*) AS n FROM content WHERE site_id=1 AND type='post' AND status='scheduled' AND COALESCE(published_at,created_at) <= ?",
      new Date().toISOString(),
    ),
    // Published posts nobody has touched in two months.
    tryFirst<Row>(
      c,
      "SELECT COUNT(*) AS n FROM content WHERE site_id=1 AND type='post' AND status='published' AND COALESCE(published_at,updated_at) < ?",
      new Date(Date.now() - 60 * 86_400_000).toISOString(),
    ),
    // Media with no alt text: an accessibility fix anyone can do in a minute.
    tryFirst<Row>(c, "SELECT COUNT(*) AS n FROM media WHERE site_id=1 AND (alt IS NULL OR trim(alt)='')"),
    // Files on disk that the library cannot read.
    tryFirst<Row>(c, "SELECT COUNT(*) AS n FROM media WHERE site_id=1 AND (filename='' OR mime='')"),
    admin
      ? installedSchemaVersion(c.env).then((version) => ({ n: version })).catch(() => null)
      : Promise.resolve(null),
    // Authors with no post yet.
    admin
      ? tryFirst<Row>(c, "SELECT COUNT(*) AS n FROM users WHERE role='author' AND id NOT IN (SELECT COALESCE(author_id,0) FROM content)")
      : Promise.resolve(null),
  ]);

  const pendingN = n(pending, 'n');
  if (pendingN) {
    items.push({
      key: 'comments-pending', tone: 'warn', count: pendingN,
      title: `${pendingN} comment${pendingN === 1 ? '' : 's'} waiting`,
      body: 'Readers are waiting for a reply to appear. Approve, reply or mark as spam.',
      href: `${base}/comments?status=pending`, cta: 'Review comments',
    });
  }

  const failedN = n(failed, 'n');
  if (failedN) {
    items.push({
      key: 'comments-spam', tone: 'info', count: failedN,
      title: `${failedN} comment${failedN === 1 ? '' : 's'} marked spam`,
      body: 'Filters hide these from readers. Check them for false positives, then delete.',
      href: `${base}/comments?status=spam`, cta: 'Check spam',
    });
  }

  const missedN = n(scheduled, 'n');
  if (missedN) {
    items.push({
      key: 'scheduled-overdue', tone: 'danger', count: missedN,
      title: `${missedN} scheduled post${missedN === 1 ? '' : 's'} past due`,
      body: 'The publish time has passed. Publish them now or move the date.',
      href: `${base}/posts?status=scheduled`, cta: 'Fix schedule',
    });
  }

  const staleN = n(stale, 'n');
  if (staleN) {
    items.push({
      key: 'stale-posts', tone: 'info', count: staleN,
      title: `${staleN} post${staleN === 1 ? '' : 's'} untouched for 60 days`,
      body: 'Old posts drift out of date. Skim the oldest ones and refresh what matters.',
      href: `${base}/posts?sort=date&dir=asc`, cta: 'Open oldest',
    });
  }

  const altN = n(unindexed, 'n');
  if (altN) {
    items.push({
      key: 'media-alt', tone: 'warn', count: altN,
      title: `${altN} image${altN === 1 ? '' : 's'} with no alt text`,
      body: 'Screen readers and search engines both need a description.',
      href: `${base}/media?alt=missing`, cta: 'Add alt text',
    });
  }

  const brokenN = n(unreadable, 'n');
  if (brokenN) {
    items.push({
      key: 'media-broken', tone: 'danger', count: brokenN,
      title: `${brokenN} media record${brokenN === 1 ? '' : 's'} incomplete`,
      body: 'A file is missing its name or type, so it may not render. Re-upload it.',
      href: `${base}/media`, cta: 'Open media',
    });
  }

  // Database updates: compare the installed schema with the highest known one.
  if (admin && migrations) {
    const applied = n(migrations, 'n');
    const pendingList = Math.max(0, SCHEMA_VERSION - applied);
    if (pendingList) {
      items.push({
        key: 'db-updates', tone: 'danger', count: pendingList,
        title: `${pendingList} database update${pendingList === 1 ? '' : 's'} ready`,
        body: 'New features stay off until the schema is updated.',
        href: `${base}/updates`, cta: 'Run update',
      });
    }
  }

  const authorsN = n(authors, 'n');
  if (authorsN) {
    items.push({
      key: 'idle-authors', tone: 'info', count: authorsN,
      title: `${authorsN} author${authorsN === 1 ? '' : 's'} with nothing published`,
      body: 'Either they need a nudge or the account can go.',
      href: `${base}/users`, cta: 'Manage users',
    });
  }

  // Anything broken outranks anything merely waiting; highest counts first
  // within a tone.
  const rank: Record<AttentionTone, number> = { danger: 0, warn: 1, info: 2 };
  items.sort((a, b) => rank[a.tone] - rank[b.tone] || b.count - a.count);
  return { items, checked: 8 };
}

export type ActivityRow = { id: number; type: string; title: string; status: string; updated_at: string };

/** "Good morning" style greeting, in the site's own timezone offset if given. */
export function greeting(name: string, now = new Date()): string {
  const hour = now.getUTCHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name || 'there'}`;
}

export { dateOnly };
