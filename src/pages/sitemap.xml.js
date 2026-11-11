export const prerender = false;
import { loadContent } from '../lib/content-source';

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export async function GET({ site, locals }) {
  const base = String(site || 'https://ams-builds.online').replace(/\/$/, '');
  const { entries } = await loadContent(locals);
  const paths = new Set(['/', '/blog/', '/projects/']);
  for (const entry of entries) {
    if (entry.data?.draft || entry.data?.noindex) continue;
    if (entry.type === 'pages') paths.add(`/${entry.slug}/`);
    if (entry.type === 'blog') paths.add(`/blog/${entry.slug}/`);
    if (entry.type === 'projects') paths.add(`/projects/${entry.slug}/`);
  }
  const urls = [...paths].sort().map((path) => `  <url><loc>${escapeXml(base + path)}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
  });
}
