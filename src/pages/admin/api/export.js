import { getStore } from '../../../lib/store.mjs';
import { json } from '../../../lib/admin-http.mjs';

export const prerender = false;

// Public content export consumed by `astro build` (and handy for backups).
// Drafts are metadata-only; tombstones keep deleted files deleted.
export async function GET({ locals }) {
  const store = await getStore(locals);
  const payload = await store.exportAll();
  return json(payload, { headers: { 'cache-control': 'no-store' } });
}
