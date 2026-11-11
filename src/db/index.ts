import schemaSql from './schema.sql';
import type { Env } from '../types';

/** Creates every table. Idempotent (CREATE ... IF NOT EXISTS). */
export async function createSchema(env: Env): Promise<void> {
  const statements = schemaSql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
}

/** True once an account exists. D1 is strongly consistent, unlike KV. */
export async function dbHasUsers(env: Env): Promise<boolean> {
  try {
    return !!(await env.DB.prepare('SELECT 1 AS x FROM users LIMIT 1').first());
  } catch {
    return false; // table does not exist yet
  }
}
