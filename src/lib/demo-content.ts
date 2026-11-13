import type { Env } from '../types';

/**
 * Demo content seeded at install time so the default theme can be tested the
 * moment a site is live: several top-level pages with sub-pages, a handful of
 * posts with categories and tags, and a primary menu. Everything is plain
 * published content an admin can edit or delete; nothing here is required.
 *
 * The statements run inside the installer's single atomic batch, in order, so a
 * sub-page can reference its parent page's id (inserted just before it) with a
 * subquery. If seeding fails, the install still succeeds — the demo is a convenience.
 */

type PageSeed = {
  title: string; slug: string; parent?: string;
  excerpt?: string; menu_order?: number;
  body?: string;
};

type PostSeed = {
  title: string; slug: string; category: string; tags: string[];
  excerpt: string; body: string;
};

const PAGES: PageSeed[] = [
  { title: 'About', slug: 'about', excerpt: 'Who we are and what we build.', menu_order: 1,
    body: '<h2>About us</h2><p>We build websites, web apps and mobile software for small and mid-size businesses. This page and its sub-pages exist so you can see how the theme renders a full page hierarchy — breadcrumbs, sub-page cards and a sidebar that nests every page.</p><p>Edit or delete any of this from the admin panel\'s Pages screen.</p>' },
  { title: 'Team', slug: 'team', parent: 'about', menu_order: 1,
    body: '<h2>The team</h2><p>A small group of developers, designers and writers. This is a sub-page of About, shown nested under it in the sidebar navigation.</p>' },
  { title: 'History', slug: 'history', parent: 'about', menu_order: 2,
    body: '<h2>Our history</h2><p>Founded to ship practical software fast, we have grown into a full-service build studio. Another sub-page, to show how the sidebar nests multiple children.</p>' },
  { title: 'Services', slug: 'services', excerpt: 'What we can build for you.', menu_order: 2,
    body: '<h2>Services</h2><p>From a single landing page to a full product, we cover web, mobile and cloud. Each service below is a sub-page linked from the sidebar.</p>' },
  { title: 'Web Development', slug: 'web-development', parent: 'services', menu_order: 1,
    body: '<h2>Web development</h2><p>Responsive websites and web applications, built fast and kept maintainable. A sub-page of Services.</p>' },
  { title: 'Mobile Apps', slug: 'mobile-apps', parent: 'services', menu_order: 2,
    body: '<h2>Mobile apps</h2><p>Native and cross-platform mobile applications for iOS and Android. Another Services sub-page.</p>' },
  { title: 'Cloud & DevOps', slug: 'cloud-devops', parent: 'services', menu_order: 3,
    body: '<h2>Cloud &amp; DevOps</h2><p>Deployment, hosting and automation. The third Services sub-page, to show a parent with several children.</p>' },
  { title: 'Guides', slug: 'guides', excerpt: 'Step-by-step tutorials.', menu_order: 3,
    body: '<h2>Guides</h2><p>Practical, written guides. Each is a sub-page so the sidebar shows a nested reading section.</p>' },
  { title: 'Getting Started', slug: 'getting-started', parent: 'guides', menu_order: 1,
    body: '<h2>Getting started</h2><p>The fastest way to launch your first page and write your first post. A Guides sub-page.</p>' },
  { title: 'Advanced Topics', slug: 'advanced-topics', parent: 'guides', menu_order: 2,
    body: '<h2>Advanced topics</h2><p>Deeper material for when you need more control. Another Guides sub-page.</p>' },
  { title: 'Contact', slug: 'contact', excerpt: 'Get in touch.', menu_order: 4,
    body: '<h2>Contact</h2><p>Reach us to start a project or ask a question. This top-level page has no sub-pages.</p>' },
  { title: 'Privacy', slug: 'privacy', menu_order: 5,
    body: '<h2>Privacy policy</h2><p>How this site handles your data. A simple top-level page.</p>' },
  { title: 'Terms', slug: 'terms', menu_order: 6,
    body: '<h2>Terms of service</h2><p>The terms that govern use of this site. Another top-level page.</p>' },
];

const POSTS: PostSeed[] = [
  { title: 'Welcome to the site', slug: 'welcome-to-the-site', category: 'News', tags: ['launch', 'news'],
    excerpt: 'A first post to show how the theme renders articles, categories and tags.',
    body: '<p>This is the first demo post. It exists so you can see how the theme renders a full article: a title, a byline, a featured-image slot, body text, tags, comments and the AdSense-ready ad slots that appear only on posts.</p><p>Write your own posts from the admin panel and delete this one whenever you are ready.</p><h3>What you get</h3><p>Every post gets the same clean reading column, a category link and tag links. The sidebar navigation stays visible so readers can jump to any page without scrolling back to the top.</p>' },
  { title: 'Building a responsive sidebar', slug: 'building-a-responsive-sidebar', category: 'Tutorials', tags: ['guides', 'tutorials'],
    excerpt: 'How the sidebar navigation adapts from desktop to mobile.',
    body: '<p>A good sidebar navigation should stay put on desktop and become a drawer on small screens. This post walks through the idea using the theme that ships with this site.</p><p>On wide screens the sidebar is a sticky column. On phones it slides in from the left when the menu button is pressed, and closes as soon as a link is tapped.</p><blockquote>The best navigation is the one a reader never has to think about.</blockquote>' },
  { title: 'Designing for dark and light', slug: 'designing-for-dark-and-light', category: 'Tutorials', tags: ['guides', 'tutorials'],
    excerpt: 'A theme that looks great in both colour schemes, with a toggle.',
    body: '<p>This theme ships both a light and a dark palette. The toggle in the header remembers a visitor\'s choice, and a site that has not been touched follows the operating system preference.</p><p>Every colour is driven by design tokens, so a brand colour set in Appearance reaches both palettes at once.</p>' },
  { title: 'Adding AdSense to your posts', slug: 'adding-adsense-to-your-posts', category: 'Updates', tags: ['updates', 'guides'],
    excerpt: 'Where the ad slots sit and how to fill them responsibly.',
    body: '<p>The theme ships two labelled ad slots on posts: one after the article body and one at the very end. Both are empty by default — paste your AdSense code into the theme settings to switch them on.</p><p>Follow AdSense policy: ads belong on content-rich posts, never beside buttons, and never on short pages.</p>' },
  { title: 'Writing clean, readable content', slug: 'writing-clean-readable-content', category: 'Tutorials', tags: ['guides', 'tutorials'],
    excerpt: 'Short paragraphs, clear headings and a reading time that helps.',
    body: '<p>Readable content is good content. Keep paragraphs short, use headings to break up the page, and let the reading-time estimate help readers decide whether to stay.</p><p>This post is long enough to show the reading-time line under the byline and to give an ad slot enough text to sit beside.</p><h3>A few tips</h3><ul><li>One idea per paragraph.</li><li>Lead with the point.</li><li>Break long sections with subheadings.</li></ul>' },
  { title: 'Site update: new pages and sub-pages', slug: 'site-update-new-pages', category: 'News', tags: ['updates', 'news'],
    excerpt: 'The demo content now includes a full page hierarchy.',
    body: '<p>We have added several top-level pages with sub-pages so the sidebar navigation has something real to show. Each parent nests its children, and the current page stays highlighted so readers always know where they are.</p>' },
  { title: 'A review of the default theme', slug: 'a-review-of-the-default-theme', category: 'Reviews', tags: ['reviews'],
    excerpt: 'What the bundled theme does well and where it shines.',
    body: '<p>The default theme is a full-colour, sidebar-driven design with a hero header, clean cards and a proper footer. It handles pages, sub-pages, posts, archives and the 404 page from one consistent shell.</p><p>Its colour scheme is changeable from four settings, and it respects any brand colours you set in Appearance.</p>' },
  { title: 'Planning your page structure', slug: 'planning-your-page-structure', category: 'Tutorials', tags: ['guides', 'tutorials'],
    excerpt: 'Thinking through top-level pages and their sub-pages.',
    body: '<p>A clear page structure helps readers and search engines alike. Start with a handful of top-level pages and give each a few sub-pages where it makes sense.</p><p>The sidebar in this theme reflects exactly that structure, nesting children under their parents automatically.</p>' },
];

/** Builds the demo-content statements to append to the installer's batch. */
export function demoContentStatements(db: Env['DB'], now: string, adminId: number) {
  const stmts: ReturnType<Env['DB']['prepare']>[] = [];
  const contentInsert = db.prepare(
    `INSERT INTO content (site_id,type,title,slug,body,excerpt,status,author_id,published_at,created_at,updated_at,menu_order,parent_id)
     VALUES (1,?,?,?,?,?,'published',?,?,?,?,?,?)`,
  );
  const pageBySlug = (slug: string) => `(SELECT id FROM content WHERE site_id=1 AND type='page' AND slug='${slug}')`;

  for (const page of PAGES) {
    stmts.push(contentInsert.bind(
      'page', page.title, page.slug, page.body ?? '', page.excerpt ?? '',
      adminId, now, now, now, page.menu_order ?? 0, page.parent ? pageBySlug(page.parent) : null,
    ));
  }

  for (const post of POSTS) {
    stmts.push(contentInsert.bind(
      'post', post.title, post.slug, post.body, post.excerpt,
      adminId, now, now, now, 0, null,
    ));
  }

  // Categories and tags, then their links. INSERT OR IGNORE keeps the unique
  // (site_id, taxonomy, slug) constraint happy if a term already exists.
  const termInsert = db.prepare('INSERT OR IGNORE INTO terms (site_id,taxonomy,name,slug) VALUES (1,?,?,?)');
  const linkInsert = db.prepare('INSERT OR IGNORE INTO content_terms (content_id,term_id) VALUES (?,?)');
  const contentIdBySlug = (slug: string) => `(SELECT id FROM content WHERE site_id=1 AND type='post' AND slug='${slug}')`;
  const termId = (taxonomy: string, slug: string) => `(SELECT id FROM terms WHERE site_id=1 AND taxonomy='${taxonomy}' AND slug='${slug}')`;

  const terms = new Map<string, string>(); // `${taxonomy}:${slug}` -> name
  const termPairs: { taxonomy: string; name: string }[] = [];
  for (const post of POSTS) {
    termPairs.push({ taxonomy: 'category', name: post.category });
    for (const tag of post.tags) termPairs.push({ taxonomy: 'tag', name: tag });
  }
  for (const pair of termPairs) {
    const slug = pair.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const key = `${pair.taxonomy}:${slug}`;
    if (!terms.has(key)) {
      terms.set(key, pair.name);
      stmts.push(termInsert.bind(pair.taxonomy, pair.name, slug));
    }
  }
  for (const post of POSTS) {
    const contentId = contentIdBySlug(post.slug);
    const pairs: { taxonomy: string; name: string }[] = [{ taxonomy: 'category', name: post.category }];
    for (const tag of post.tags) pairs.push({ taxonomy: 'tag', name: tag });
    for (const pair of pairs) {
      const slug = pair.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      stmts.push(linkInsert.bind(contentId, termId(pair.taxonomy, slug)));
    }
  }

  // A primary menu that mirrors the top-level pages, so menu-driven themes and
  // the sidebar both have something to show. Home and Blog are already seeded
  // by the installer, so they are not repeated here.
  const menuItems = [
    { label: 'About', url: '/about', pos: 2 },
    { label: 'Services', url: '/services', pos: 3 },
    { label: 'Guides', url: '/guides', pos: 4 },
    { label: 'Contact', url: '/contact', pos: 5 },
  ];
  const menuItemInsert = db.prepare('INSERT INTO menu_items (menu_id,label,url,position) VALUES (1,?,?,?)');
  for (const item of menuItems) stmts.push(menuItemInsert.bind(item.label, item.url, item.pos));

  return stmts;
}
