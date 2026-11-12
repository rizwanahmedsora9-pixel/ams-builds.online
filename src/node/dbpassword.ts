/**
 * Boot-time database password check for the Node runtime.
 *
 * `DB_PASSWORD` is the password of the SQLite file in `DATA_DIR`:
 *
 *   - first start with it  -> the database is locked to that password
 *   - later starts         -> the same password must be presented again
 *   - wrong or missing     -> the server exits before it listens, so no request
 *                             is ever served from a database it may not open
 *
 * `DB_PASSWORD_UNLOCK=1` is the way out for somebody who has the files but lost
 * the password: it clears the stored check once, loudly, and leaves every row
 * alone. That is not a hole in the model - anyone able to set environment
 * variables for the process can also read `cms.sqlite` directly.
 *
 * Cloudflare does not run this file. D1 is reached through the Worker binding and
 * has no password; see lib/dblock.ts.
 */
import type { Env } from '../types';
import { DB_PASSWORD_MIN, clearDbLock, dbLockState, setDbLock, verifyDbLock } from '../lib/dblock';

export type DbPasswordOutcome = {
  /** False means "do not start". */
  start: boolean;
  /** What to print, so the operator knows which of the four cases happened. */
  message: string;
};

const truthy = (v: string | undefined): boolean => /^(1|true|yes)$/i.test(v || '');

export async function checkDbPassword(
  env: Env,
  opts: { password?: string; unlock?: string; dataDir?: string } = {},
): Promise<DbPasswordOutcome> {
  const password = opts.password ?? '';
  const file = `${opts.dataDir ?? './data'}/cms.sqlite`;
  const state = await dbLockState(env);

  if (state === 'unset') {
    if (!password) {
      return {
        start: true,
        message: `Database password: not set. ${file} is protected by its file permissions only.\n`
          + `  Set DB_PASSWORD (at least ${DB_PASSWORD_MIN} characters) to make the panel refuse to open it without one.`,
      };
    }
    if (password.length < DB_PASSWORD_MIN) {
      return {
        start: false,
        message: `DB_PASSWORD is shorter than ${DB_PASSWORD_MIN} characters, so the database was not locked.\n`
          + '  Use a longer password, or unset DB_PASSWORD to start without one.',
      };
    }
    await setDbLock(env, password);
    return {
      start: true,
      message: `Database password: set, and ${file} is now locked to it.\n`
          + '  Keep DB_PASSWORD in this server\'s environment: every later start needs the same one.',
    };
  }

  if (password && await verifyDbLock(env, password)) {
    return { start: true, message: 'Database password: accepted. This database is locked to DB_PASSWORD.' };
  }

  if (truthy(opts.unlock)) {
    await clearDbLock(env);
    return {
      start: true,
      message: 'DB_PASSWORD_UNLOCK=1 removed the stored database password. Nothing else was changed.\n'
        + '  The database is open to any start again; set DB_PASSWORD to lock it once more.',
    };
  }

  return {
    start: false,
    message: `This database is password-protected and DB_PASSWORD is ${password ? 'wrong' : 'missing'}. Nothing was served and no data was changed.\n`
      + `  Open it with its password:  DB_PASSWORD=your-password node dist/server.mjs\n`
      + '  Or remove the protection on purpose, once:  DB_PASSWORD_UNLOCK=1 node dist/server.mjs',
  };
}
