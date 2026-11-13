/**
 * The audit log: who changed what, when.
 *
 * One helper writes every entry (`logAudit`), and every mutation calls it, so
 * answering "who deleted that post" is a query rather than an archaeology
 * project. Three rules shaped it:
 *
 *  1. **Writing never breaks a mutation.** An audit insert that fails (an old
 *     database, a locked row) is swallowed and logged to the console: losing a
 *     log line is bad, failing a save because of one is worse.
 *  2. **The summary is written for a human.** "Deleted post “Launch notes”" is
 *     more useful at 2am than `content.delete id=42`. Values are truncated.
 *  3. **Retention is bounded.** Ninety days, pruned by the cron trigger, so the
 *     table cannot grow without limit on a small plan.
 */
import type { Ctx, Env, User } from '../types';
import { hasTable } from './schema';
import { clientIp } from './security';

export const AUDIT_RETENTION_DAYS = 90;

/** The actions a filter can name. Anything not here is still stored. */
export const AUDIT_ACTIONS = [
  'created', 'updated', 'deleted', 'published', 'activated', 'installed',
  'login', 'settings', 'moderated', 'restored', 'exported', 'imported', 'failed',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Object families, so the viewer can filter without free text. */
export const AUDIT_TYPES = ['content', 'theme', 'setting', 'user', 'comment', 'media', 'menu', 'term', 'plugin', 'system'] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export type AuditEntry = {
  userId: number | null;
  action: AuditAction | string;
  objectType: AuditType | string;
  objectId?: number | string | null;
  summary: string;
  ip?: string;
};

/**
 * Records one mutation. Call it *after* the change succeeded, so the log never
 * claims something happened that did not.
 */
export async function logAudit(c: Ctx, entry: AuditEntry): Promise<void>;
export async function logAudit(env: Env, user: Pick<User, 'id'> | null, entry: AuditEntry): Promise<void>;
export async function logAudit(
  target: Ctx | Env,
  userOrEntry: Pick<User, 'id'> | null | AuditEntry,
  maybeEntry?: AuditEntry,
): Promise<void> {
  const user = maybeEntry ? (userOrEntry as Pick<User, 'id'> | null) : null;
  const entry = (maybeEntry ?? (userOrEntry as AuditEntry));
  const env = (target as Ctx).env ?? (target as Env);
  const ip = entry.ip ?? (maybeEntry && (target as Ctx).req ? clientIp((target as Ctx).req.raw) : '');
  try {
    if (!(await hasTable(env, 'audit_log'))) return;
    await env.DB.prepare(
      'INSERT INTO audit_log (user_id, action, object_type, object_id, summary, ip, created_at) VALUES (?,?,?,?,?,?,?)',
    ).bind(
      user?.id ?? entry.userId ?? null,
      String(entry.action).slice(0, 40),
      String(entry.objectType).slice(0, 30),
      entry.objectId == null ? null : String(entry.objectId).slice(0, 40),
      String(entry.summary).slice(0, 300),
      String(ip ?? '').slice(0, 60),
      new Date().toISOString(),
    ).run();
  } catch (err) {
    // Never let bookkeeping fail the thing it is bookkeeping for.
    console.error('audit log write failed:', err);
  }
}

/** Convenience for the common case: the signed-in user, on this request. */
export const audit = (c: Ctx, action: AuditAction, objectType: AuditType, summary: string, objectId?: number | string | null): Promise<void> =>
  logAudit(c, { action, objectType, summary, objectId: objectId ?? null, userId: c.var.user.id });

export type AuditRow = {
  id: number;
  user_id: number | null;
  action: string;
  object_type: string;
  object_id: string | null;
  summary: string;
  ip: string;
  created_at: string;
  username: string | null;
};

export type AuditFilter = { userId?: number; action?: string; objectType?: string; q?: string; before?: number; limit?: number };

/** One page of entries, newest first, with the filters the viewer offers. */
export async function readAudit(env: Env, filter: AuditFilter = {}): Promise<AuditRow[]> {
  const where: string[] = [];
  const bind: (string | number)[] = [];
  if (filter.userId) { where.push('a.user_id=?'); bind.push(filter.userId); }
  if (filter.action) { where.push('a.action=?'); bind.push(filter.action); }
  if (filter.objectType) { where.push('a.object_type=?'); bind.push(filter.objectType); }
  if (filter.q) { where.push('(a.summary LIKE ? OR a.object_id LIKE ?)'); bind.push(`%${filter.q}%`, `%${filter.q}%`); }
  if (filter.before) { where.push('a.id<?'); bind.push(filter.before); }
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  try {
    const { results } = await env.DB.prepare(
      `SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ${limit}`,
    ).bind(...bind).all<AuditRow>();
    return results;
  } catch {
    return [];
  }
}

/** A count per action, for the viewer's chips. */
export async function auditCounts(env: Env): Promise<{ total: number; byAction: Record<string, number> }> {
  try {
    const { results } = await env.DB.prepare('SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action').all<{ action: string; n: number }>();
    const byAction: Record<string, number> = {};
    for (const r of results) byAction[r.action] = Number(r.n);
    return { total: Object.values(byAction).reduce((a, b) => a + b, 0), byAction };
  } catch {
    return { total: 0, byAction: {} };
  }
}

/** Retention: entries older than the window are removed. Called by cron. */
export async function pruneAudit(env: Env): Promise<number> {
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86400_000).toISOString();
  try {
    if (!(await hasTable(env, 'audit_log'))) return 0;
    const res = await env.DB.prepare('DELETE FROM audit_log WHERE created_at<?').bind(cutoff).run();
    return Number(res.meta.changes ?? 0);
  } catch {
    return 0;
  }
}
