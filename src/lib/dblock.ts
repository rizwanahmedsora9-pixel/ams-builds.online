/**
 * The database password.
 *
 * Neither runtime has a database *server* to log into: on Node the database is a
 * SQLite file (`data/cms.sqlite`) opened by the process itself, and on Cloudflare
 * it is D1, reached only through the Worker binding. So there is no password
 * prompt to answer and nothing to encrypt against - `node:sqlite` has no cipher
 * and adding one would mean a native module this project deliberately does not
 * have.
 *
 * What a password can still do here is decide **whether the panel is allowed to
 * open this database at all**. The first start that carries `DB_PASSWORD` records
 * a hash of it next to the data; from then on a server that does not present the
 * same password refuses to start, which is what stops a copied `data/` folder, a
 * restored volume or a second deployment from being opened by someone who was
 * never given the password.
 *
 * It is an access check, not encryption at rest: anybody who can read the file
 * can read the file. For that, encrypt the disk or the volume. The README says so
 * in as many words, and Tools -> Site Health reports which of the two you have.
 */
import type { Env } from '../types';
import { hashPassword, verifyPassword } from './auth';

/** KV key holding the hash. Lives with the data it protects. */
const KEY = 'db_password';

/** Same floor as a panel account: short passwords are not worth the ceremony. */
export const DB_PASSWORD_MIN = 8;

export type DbLockState = 'set' | 'unset';

/** Whether this database insists on a password. Never throws: an unreadable
 *  store answers "unset", and the caller then behaves as it did before. */
export async function dbLockState(env: Env): Promise<DbLockState> {
  try {
    return (await env.KV.get(KEY)) ? 'set' : 'unset';
  } catch {
    return 'unset';
  }
}

/** Locks the database to `password`, replacing any previous one. */
export async function setDbLock(env: Env, password: string): Promise<void> {
  await env.KV.put(KEY, await hashPassword(password));
}

/** Removes the check. The data is untouched; the next start needs no password. */
export async function clearDbLock(env: Env): Promise<void> {
  await env.KV.delete(KEY);
}

export async function verifyDbLock(env: Env, password: string): Promise<boolean> {
  if (!password) return false;
  const stored = await env.KV.get(KEY);
  // Always run PBKDF2 when a hash exists, so timing does not leak the state.
  return stored ? verifyPassword(password, stored) : (await hashPassword(password), false);
}
