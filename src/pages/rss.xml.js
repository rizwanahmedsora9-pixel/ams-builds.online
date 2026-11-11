export const prerender = true;
import rss from '@astrojs/rss';
import { contentCollection } from '../lib/content-source';
export async function GET(context) {
  const posts = await contentCollection('blog', ({data}) => !data.draft);
  return rss({
    title: 'AMS Builds Blog',
    description: 'Business tips, website & app guides for Pakistani businesses.',
    site: context.site,
    items: posts.sort((a,b) => +new Date(b.data.pubDate) - +new Date(a.data.pubDate)).map(p => ({
      title: p.data.title, description: p.data.description, pubDate: p.data.pubDate,
      link: `/blog/${p.slug}/`, categories: p.data.tags || [],
    })),
    customData: '<language>en-pk</language>',
  });
}
