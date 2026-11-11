export const prerender = false;

export async function GET({ site }) {
  const base = String(site || 'https://ams-builds.online').replace(/\/$/, '');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${base}/sitemap.xml</loc></sitemap></sitemapindex>`;
  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
  });
}
