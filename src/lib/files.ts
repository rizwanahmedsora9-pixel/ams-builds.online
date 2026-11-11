import type { Env } from '../types';

/**
 * Where uploaded files live.
 *  - Cloudflare: in KV, under "media:{key}" (binary value + metadata). No extra
 *    service to enable. KV values are limited to 25 MB each.
 *  - Node.js: the server provides a disk-backed FILES store (data/media/).
 */
export type StoredFile = { body: ReadableStream | ArrayBuffer; contentType: string; etag: string };

/** Largest upload accepted on every platform (KV's hard limit is 25 MB). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const PREFIX = 'media:';
type KvMeta = { contentType?: string; etag?: string };

async function sha1(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function putFile(env: Env, key: string, data: ArrayBuffer, contentType: string): Promise<void> {
  if (env.FILES) {
    await env.FILES.put(key, data, contentType);
    return;
  }
  await env.KV.put(PREFIX + key, data, { metadata: { contentType, etag: await sha1(data) } satisfies KvMeta });
}

export async function getFile(env: Env, key: string): Promise<StoredFile | null> {
  if (env.FILES) return env.FILES.get(key);
  const { value, metadata } = await env.KV.getWithMetadata<KvMeta>(PREFIX + key, 'arrayBuffer');
  if (value === null) return null;
  return { body: value, contentType: metadata?.contentType || 'application/octet-stream', etag: metadata?.etag || '' };
}

export async function deleteFile(env: Env, key: string): Promise<void> {
  if (env.FILES) await env.FILES.delete(key);
  else await env.KV.delete(PREFIX + key);
}
