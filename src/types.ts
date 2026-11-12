import type { Context } from 'hono';

export type Env = {
  DB: D1Database;
  /** Optional file store. Absent on Cloudflare (uploads go to KV); the Node server supplies a disk-backed one. */
  FILES?: FileStore;
  KV: KVNamespace;
};

export type FileStore = {
  put(key: string, data: ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream | ArrayBuffer; contentType: string; etag: string } | null>;
  delete(key: string): Promise<void>;
};

/** Stored in KV under "config". Read on every request, so keep it tiny. */
export type Config = {
  adminSlug: string;
  secret: string; // HMAC key for sessions + CSRF
  cacheV: number; // page-cache generation; bump to invalidate everything
  primaryDomain: string;
  domains: string[];
};

export type Role = 'admin' | 'editor' | 'author';
export type User = { id: number; username: string; email: string; role: Role };

export type AppEnv = {
  Bindings: Env;
  Variables: {
    cfg: Config;
    base: string; // "/{admin-slug}"
    user: User;
    csrf: string;
    form: FormData;
  };
};
export type Ctx = Context<AppEnv>;

export type ContentRow = {
  id: number;
  type: 'page' | 'post';
  title: string;
  slug: string;
  body: string;
  excerpt: string;
  status: 'draft' | 'published' | 'scheduled';
  seo_title: string;
  seo_description: string;
  featured_media_id: number | null;
  author_id: number | null;
  published_at: string | null;
  updated_by?: number | null;
  menu_order?: number;
  /** Parent page for the Pages hierarchy; posts always leave this empty. */
  parent_id?: number | null;
  pinned?: number;
  /** Theme template that renders this item; '' means the default for its kind. */
  template?: string;
  created_at: string;
  updated_at: string;
  author?: string | null;
  media_key?: string | null;
  media_alt?: string | null;
};
