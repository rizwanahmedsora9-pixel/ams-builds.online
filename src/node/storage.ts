/**
 * Node.js implementations of the storage the CMS uses, so
 * the exact same app code runs on a VPS, in Docker or on a laptop:
 *   D1  -> SQLite file (node:sqlite, built into Node 22.13+)
 *   KV  -> table in the same SQLite file (with expiry)
 *   uploads -> files on disk + a small metadata table (Cloudflare keeps them in KV)
 * Only the parts of each API that the CMS calls are implemented.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { Env } from '../types';

type Meta = { changes: number; last_row_id: number; duration: number };
type Result = { success: true; results: Record<string, unknown>[]; meta: Meta };

const toParam = (v: unknown): SQLInputValue => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SQLInputValue;
};
const returnsRows = (sql: string) => /^\s*(select|with|pragma|values)\b/i.test(sql) || /\breturning\b/i.test(sql);

/* ----------------------------------------------------------------------- D1 */
class Statement {
  constructor(private db: DatabaseSync, private sql: string, private params: SQLInputValue[] = []) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.db, this.sql, values.map(toParam));
  }

  /** Synchronous core, also used inside batch transactions. */
  exec(): Result {
    const stmt = this.db.prepare(this.sql);
    if (returnsRows(this.sql)) {
      const rows = stmt.all(...this.params).map((r) => ({ ...r })) as Record<string, unknown>[];
      return { success: true, results: rows, meta: { changes: 0, last_row_id: 0, duration: 0 } };
    }
    const info = stmt.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid), duration: 0 } };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.exec().results[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }
  async all(): Promise<Result> { return this.exec(); }
  async run(): Promise<Result> { return this.exec(); }
}

class Database {
  constructor(private db: DatabaseSync) {}
  prepare(sql: string): Statement { return new Statement(this.db, sql); }

  /** Like D1: all statements run in one transaction and roll back together. */
  async batch(statements: Statement[]): Promise<Result[]> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = statements.map((s) => s.exec());
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.db.exec(sql);
    return { count: 1, duration: 0 };
  }
}

/* ----------------------------------------------------------------------- KV */
class KeyValue {
  constructor(private db: DatabaseSync) {
    db.exec('CREATE TABLE IF NOT EXISTS _kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER)');
  }
  async get(key: string, type?: 'text' | 'json' | { type?: string }): Promise<unknown> {
    const row = this.db.prepare('SELECT value, expires FROM _kv WHERE key=?').get(key) as { value: string; expires: number | null } | undefined;
    if (!row || (row.expires !== null && row.expires <= Date.now() / 1000)) return null;
    const kind = typeof type === 'string' ? type : type?.type;
    return kind === 'json' ? JSON.parse(row.value) : row.value;
  }
  async put(key: string, value: string, opts?: { expirationTtl?: number; expiration?: number }): Promise<void> {
    const expires = opts?.expiration ?? (opts?.expirationTtl ? Math.floor(Date.now() / 1000) + opts.expirationTtl : null);
    this.db.prepare('INSERT INTO _kv (key,value,expires) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires=excluded.expires')
      .run(key, String(value), expires);
  }
  async delete(key: string): Promise<void> {
    this.db.prepare('DELETE FROM _kv WHERE key=?').run(key);
  }
  /** Housekeeping: drop expired cache pages and rate-limit counters. */
  purgeExpired(): void {
    this.db.prepare('DELETE FROM _kv WHERE expires IS NOT NULL AND expires<=?').run(Math.floor(Date.now() / 1000));
  }
}

/* -------------------------------------------------------------------- files */
class DiskFiles {
  private root: string;
  constructor(private db: DatabaseSync, dir: string) {
    this.root = resolve(dir);
    mkdirSync(this.root, { recursive: true });
    db.exec('CREATE TABLE IF NOT EXISTS _files (key TEXT PRIMARY KEY, content_type TEXT, size INTEGER NOT NULL, etag TEXT NOT NULL, uploaded TEXT NOT NULL)');
  }

  /** Maps an object key to a path that is guaranteed to stay inside the media folder. */
  private path(key: string): string | null {
    if (!key || key.includes('\0') || key.split('/').some((p) => p === '' || p === '.' || p === '..')) return null;
    const full = resolve(this.root, ...key.split('/'));
    return full.startsWith(this.root + sep) ? full : null;
  }

  async get(key: string) {
    const file = this.path(key);
    const row = this.db.prepare('SELECT content_type, etag FROM _files WHERE key=?').get(key) as { content_type: string | null; etag: string } | undefined;
    if (!file || !row || !(await stat(file).catch(() => null))) return null;
    return {
      contentType: row.content_type || 'application/octet-stream',
      etag: row.etag,
      body: Readable.toWeb(createReadStream(file)) as unknown as ReadableStream,
    };
  }

  async put(key: string, data: ArrayBuffer, contentType: string): Promise<void> {
    const file = this.path(key);
    if (!file) throw new Error('Invalid file key');
    mkdirSync(dirname(file), { recursive: true });
    const buf = Buffer.from(data);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await writeFile(tmp, buf);
      await rename(tmp, file); // readers never see a half-written file
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    this.db.prepare('INSERT INTO _files (key,content_type,size,etag,uploaded) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET content_type=excluded.content_type, size=excluded.size, etag=excluded.etag, uploaded=excluded.uploaded')
      .run(key, contentType, buf.length, createHash('sha1').update(buf).digest('hex'), new Date().toISOString());
  }

  async delete(key: string): Promise<void> {
    const file = this.path(key);
    if (file) await rm(file, { force: true });
    this.db.prepare('DELETE FROM _files WHERE key=?').run(key);
  }
}

/** Opens (creating if needed) the data directory and returns the bindings the app expects. */
export function openStorage(dataDir: string): { env: Env; purgeExpired: () => void; close: () => void } {
  const dir = resolve(dataDir);
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'cms.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  const kv = new KeyValue(db);
  const env = {
    DB: new Database(db),
    KV: kv,
    FILES: new DiskFiles(db, join(dir, 'media')),
  } as unknown as Env;
  return { env, purgeExpired: () => kv.purgeExpired(), close: () => db.close() };
}
