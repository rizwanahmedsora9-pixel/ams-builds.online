/**
 * Revisions and edit locks - the "never lose work" half of the editor.
 *
 * Every save writes a snapshot of the row *as it was before* the save, and
 * autosave writes a separate row with `note='autosave'`. Restoring writes the
 * current state first, so a restore is itself reversible. The history is capped
 * per item (25 by default) and pruned after each write and from the cron.
 */
import type { ContentRow, Env } from '../types';
import { hasPhase2Schema, resetSchemaCache } from '../lib/schema';

export type RevisionRow = {
  id: number;
  content_id: number;
  title: string;
  slug: string;
  body: string;
  excerpt: string;
  seo_title: string;
  seo_description: string;
  status: string;
  author_id: number | null;
  note: string;
  created_at: string;
  username?: string | null;
};

/** Keep this many snapshots per item; autosaves count separately. */
export const REVISION_KEEP = 25;
export const AUTOSAVE_KEEP = 8;

const FIELDS = ['title', 'slug', 'body', 'excerpt', 'seo_title', 'seo_description', 'status'] as const;

/**
 * Run a query that needs the Phase 2 tables and fall back if they are not there.
 *
 * The existence probe is cached for a few seconds, so a table dropped (or not
 * yet created) under a running server can still fail here. When that happens
 * the cache is cleared, so the next request re-probes instead of failing again.
 * Everything in this module is advice: none of it may break a save or a page.
 */
async function phase2<T>(env: Env, run: () => Promise<T>, fallback: T): Promise<T> {
  if (!(await hasPhase2Schema(env))) return fallback;
  try {
    return await run();
  } catch {
    resetSchemaCache(env);
    return fallback;
  }
}

/** A snapshot of the row as it is right now. */
export function snapshot(row: ContentRow): Omit<RevisionRow, 'id' | 'created_at'> {
  return {
    content_id: row.id,
    title: row.title,
    slug: row.slug,
    body: row.body,
    excerpt: row.excerpt,
    seo_title: row.seo_title,
    seo_description: row.seo_description,
    status: row.status,
    author_id: row.author_id,
    note: '',
  };
}

/** True when nothing a person would call "content" changed. */
export function sameContent(a: Pick<RevisionRow, (typeof FIELDS)[number]>, b: Pick<RevisionRow, (typeof FIELDS)[number]>): boolean {
  return FIELDS.every((f) => (a[f] ?? '') === (b[f] ?? ''));
}

export async function recordRevision(
  env: Env,
  row: ContentRow,
  opts: { note?: string; authorId?: number | null } = {},
): Promise<number | null> {
  if (!(await hasPhase2Schema(env))) return null;
  const snap = snapshot(row);
  try {
    return await insertRevision(env, snap, opts);
  } catch {
    // History is a convenience: a missing table or a race with a migration must
    // never turn into a failed save.
    return null;
  }
}

async function insertRevision(
  env: Env,
  snap: Omit<RevisionRow, 'id' | 'created_at'>,
  opts: { note?: string; authorId?: number | null },
): Promise<number | null> {
  const res = await env.DB.prepare(
    `INSERT INTO content_revisions (site_id,content_id,title,slug,body,excerpt,seo_title,seo_description,status,author_id,note,created_at)
     VALUES (1,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    snap.content_id, snap.title, snap.slug, snap.body, snap.excerpt,
    snap.seo_title, snap.seo_description, snap.status,
    opts.authorId ?? snap.author_id, String(opts.note || ''), new Date().toISOString(),
  ).run();
  return Number(res.meta.last_row_id);
}

/**
 * Trim the history: keep the newest REVISION_KEEP manual snapshots and the
 * newest AUTOSAVE_KEEP autosaves, so a long writing session cannot push the
 * restore points out of the list.
 */
export async function pruneRevisions(env: Env, contentId: number): Promise<void> {
  if (!(await hasPhase2Schema(env))) return;
  try {
    await pruneRevisionsUnsafe(env, contentId);
  } catch {
    /* pruning is housekeeping */
  }
}

async function pruneRevisionsUnsafe(env: Env, contentId: number): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM content_revisions WHERE content_id=? AND note=''
       AND id NOT IN (SELECT id FROM content_revisions WHERE content_id=? AND note='' ORDER BY id DESC LIMIT ?)`,
  ).bind(contentId, contentId, REVISION_KEEP).run();
  await env.DB.prepare(
    `DELETE FROM content_revisions WHERE content_id=? AND note='autosave'
       AND id NOT IN (SELECT id FROM content_revisions WHERE content_id=? AND note='autosave' ORDER BY id DESC LIMIT ?)`,
  ).bind(contentId, contentId, AUTOSAVE_KEEP).run();
}

export async function listRevisions(env: Env, contentId: number): Promise<RevisionRow[]> {
  return phase2(env, async () => {
    const { results } = await env.DB.prepare(
      `SELECT r.*, u.username FROM content_revisions r LEFT JOIN users u ON u.id=r.author_id
       WHERE r.content_id=? ORDER BY r.id DESC LIMIT 100`,
    ).bind(contentId).all<RevisionRow>();
    return results;
  }, [] as RevisionRow[]);
}

export async function getRevision(env: Env, contentId: number, id: number): Promise<RevisionRow | null> {
  return phase2(env, () => env.DB.prepare('SELECT * FROM content_revisions WHERE id=? AND content_id=?')
    .bind(id, contentId).first<RevisionRow>(), null);
}

export async function latestAutosave(env: Env, contentId: number): Promise<RevisionRow | null> {
  return phase2(env, () => env.DB.prepare(
    "SELECT * FROM content_revisions WHERE content_id=? AND note='autosave' ORDER BY id DESC LIMIT 1",
  ).bind(contentId).first<RevisionRow>(), null);
}

/** How many snapshots exist for an item (used by the editor's History card). */
export async function countRevisions(env: Env, contentId: number): Promise<number> {
  return phase2(env, async () => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM content_revisions WHERE content_id=?')
      .bind(contentId).first<{ n: number }>();
    return Number(row?.n || 0);
  }, 0);
}

export async function deleteRevisions(env: Env, contentId: number): Promise<void> {
  if (!(await hasPhase2Schema(env))) return;
  await env.DB.prepare('DELETE FROM content_revisions WHERE content_id=?').bind(contentId).run();
}

/** Cron: drop autosaves older than a fortnight, and orphaned history. */
export async function pruneAllRevisions(env: Env): Promise<number> {
  if (!(await hasPhase2Schema(env))) return 0;
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const stale = await env.DB.prepare("DELETE FROM content_revisions WHERE note='autosave' AND created_at<?").bind(cutoff).run();
  const orphans = await env.DB.prepare(
    'DELETE FROM content_revisions WHERE content_id NOT IN (SELECT id FROM content)',
  ).run();
  return (stale.meta.changes || 0) + (orphans.meta.changes || 0);
}

/* ------------------------------------------------------------------- diff */

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string; oldNo: number | null; newNo: number | null };

/**
 * Line-based diff for the revision screen. A plain LCS table is fine here:
 * content is a few hundred lines and this runs on demand, not per request
 * path. Long bodies are trimmed to keep the rendered page honest.
 */
export function diffLines(before: string, after: string, maxLines = 600): DiffLine[] {
  const a = before.replace(/\r\n/g, '\n').split('\n').slice(0, maxLines);
  const b = after.replace(/\r\n/g, '\n').split('\n').slice(0, maxLines);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i], oldNo: i + 1, newNo: j + 1 });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'del', text: a[i], oldNo: i + 1, newNo: null });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j], oldNo: null, newNo: j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i], oldNo: ++i, newNo: null });
  while (j < m) out.push({ kind: 'add', text: b[j], oldNo: null, newNo: ++j });
  return out;
}

/** Collapse long runs of unchanged lines so a diff stays readable. */
export function collapseDiff(lines: DiffLine[], context = 3): (DiffLine | { kind: 'gap'; text: string; oldNo: null; newNo: null })[] {
  const keep = new Set<number>();
  lines.forEach((line, idx) => {
    if (line.kind === 'same') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep.add(k);
  });
  const out: (DiffLine | { kind: 'gap'; text: string; oldNo: null; newNo: null })[] = [];
  let skipped = 0;
  lines.forEach((line, idx) => {
    if (keep.has(idx)) {
      if (skipped) {
        out.push({ kind: 'gap', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}`, oldNo: null, newNo: null });
        skipped = 0;
      }
      out.push(line);
    } else skipped++;
  });
  if (skipped) out.push({ kind: 'gap', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}`, oldNo: null, newNo: null });
  return out;
}

/* ------------------------------------------------------------------- locks */

export const LOCK_TTL_MS = 150_000; // 2.5 minutes without a heartbeat frees the row

export type LockInfo = { user_id: number; username: string; heartbeat_at: string; mine: boolean; stale: boolean };

export async function readLock(env: Env, contentId: number, userId: number): Promise<LockInfo | null> {
  return phase2(env, async () => {
    const row = await env.DB.prepare('SELECT user_id, username, heartbeat_at FROM content_lock WHERE content_id=?')
      .bind(contentId).first<{ user_id: number; username: string; heartbeat_at: string }>();
    if (!row) return null;
    if (Date.now() - Date.parse(row.heartbeat_at) > LOCK_TTL_MS) return null;
    return { ...row, mine: row.user_id === userId, stale: false } as LockInfo;
  }, null);
}

/** Claim or refresh the lock. Returns the holder if somebody else has it. */
export async function claimLock(env: Env, contentId: number, user: { id: number; username: string }, force = false): Promise<LockInfo | null> {
  return phase2(env, async () => {
    const current = await readLock(env, contentId, user.id);
    if (current && !current.mine && !force) return current;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO content_lock (content_id,user_id,username,heartbeat_at) VALUES (?,?,?,?)
       ON CONFLICT(content_id) DO UPDATE SET user_id=excluded.user_id, username=excluded.username, heartbeat_at=excluded.heartbeat_at`,
    ).bind(contentId, user.id, user.username, now).run();
    return null;
  }, null);
}

export async function releaseLock(env: Env, contentId: number, userId: number): Promise<void> {
  if (!(await hasPhase2Schema(env))) return;
  try {
    await env.DB.prepare('DELETE FROM content_lock WHERE content_id=? AND user_id=?').bind(contentId, userId).run();
  } catch {
    /* advisory only */
  }
}

export async function pruneLocks(env: Env): Promise<number> {
  if (!(await hasPhase2Schema(env))) return 0;
  const cutoff = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  const res = await env.DB.prepare('DELETE FROM content_lock WHERE heartbeat_at<?').bind(cutoff).run();
  return res.meta.changes || 0;
}
