export const prerender = false;
import rss from '@astrojs/rss';
import { contentCollection } from '../lib/content-source';

export async function GET(context) {
  const posts = await contentCollection('blog', ({ data }) => !data.draft, context.locals);
  return rss({
    title: 'AMS Builds Blog',
    description: 'Business tips, website & app guides for Pakistani businesses.',
    site: context.site,
    items: posts.sort((a, b) => +new Date(b.data.pubDate) - +new Date(a.data.pubDate)).map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.slug}/`,
      categories: post.data.tags || [],
    })),
    customData: '<language>en-pk</language>',
  });
}
