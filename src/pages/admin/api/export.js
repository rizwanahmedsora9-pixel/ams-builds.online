import { getStore } from '../../../lib/store.mjs';
import { json } from '../../../lib/admin-http.mjs';

export const prerender = false;

// Published bodies and settings are public; draft bodies and deleted content
// are stripped by exportAll. Uploaded-image metadata is included for backups.
export async function GET({ locals, url }) {
  const store = await getStore(locals);
  const payload = await store.exportAll();
  payload.media = await store.listMedia();
  payload.exported_at = new Date().toISOString();
  const headers = { 'cache-control': 'no-store' };
  if (url.searchParams.get('download') === '1') {
    headers['content-disposition'] = `attachment; filename="ams-cms-backup-${new Date().toISOString().slice(0, 10)}.json"`;
  }
  return json(payload, { headers });
}
