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
    body: '<h2>About us</h2><p>We build websites, web apps and mobile software for small and mid-size businesses. This page and its sub-pages exist so you can see how the theme renders a full page hierarchy — breadcrumbs and sub-page cards, with the top-level pages listed in the header and footer.</p><p>Edit or delete any of this from the admin panel\'s Pages screen.</p>' },
  { title: 'Team', slug: 'team', parent: 'about', menu_order: 1,
    body: '<h2>The team</h2><p>A small group of developers, designers and writers. This is a sub-page of About, linked from the About page as a sub-page card.</p>' },
  { title: 'History', slug: 'history', parent: 'about', menu_order: 2,
    body: '<h2>Our history</h2><p>Founded to ship practical software fast, we have grown into a full-service build studio. Another sub-page, to show a parent page with more than one child.</p>' },
  { title: 'Services', slug: 'services', excerpt: 'What we can build for you.', menu_order: 2,
    body: '<h2>Services</h2><p>From a single landing page to a full product, we cover web, mobile and cloud. Each service below is a sub-page, linked from this page.</p>' },
  { title: 'Web Development', slug: 'web-development', parent: 'services', menu_order: 1,
    body: '<h2>Web development</h2><p>Responsive websites and web applications, built fast and kept maintainable. A sub-page of Services.</p>' },
  { title: 'Mobile Apps', slug: 'mobile-apps', parent: 'services', menu_order: 2,
    body: '<h2>Mobile apps</h2><p>Native and cross-platform mobile applications for iOS and Android. Another Services sub-page.</p>' },
  { title: 'Cloud & DevOps', slug: 'cloud-devops', parent: 'services', menu_order: 3,
    body: '<h2>Cloud &amp; DevOps</h2><p>Deployment, hosting and automation. The third Services sub-page, to show a parent with several children.</p>' },
  { title: 'Guides', slug: 'guides', excerpt: 'Step-by-step tutorials.', menu_order: 3,
    body: '<h2>Guides</h2><p>Practical, written guides. Each is a sub-page, so this section reads as a small library.</p>' },
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
    body: '<p>This is the first demo post. It exists so you can see how the theme renders a full article: a title, a byline, a featured-image slot, body text, tags and share buttons.</p><p>Write your own posts from the admin panel and delete this one whenever you are ready.</p><h3>What you get</h3><p>Every post gets the same clean reading column, category and tag chips, and share buttons. The header stays in view while scrolling, so readers can jump to any page without going back to the top.</p>' },
  { title: 'Building a responsive menu', slug: 'building-a-responsive-menu', category: 'Tutorials', tags: ['guides', 'tutorials'],
    excerpt: 'How the navigation adapts from desktop to mobile.',
    body: '<p>A good menu should sit in the header on desktop and fold away on small screens. This post walks through the idea using the theme that ships with this site.</p><p>On wide screens the menu is a row in the sticky header, with sub-menus as dropdowns. On phones it slides down when the menu button is pressed, and closes as soon as a link is tapped.</p><blockquote>The best navigation is the one a reader never has to think about.</blockquote>' },
  { title: 'Designing for dark and light', slug: 'designing-for-dark-and-light', category: 'Tutorials', tags: ['guides', 'tutorials'],
    excerpt: 'A theme that looks great in both colour schemes, with a toggle.',
    body: '<p>This theme ships both a light and a dark palette. The toggle in the header remembers a visitor\'s choice, and a site that has not been touched follows the operating system preference.</p><p>The accent colour is one theme setting, so a brand colour set in Appearance reaches both palettes at once.</p>' },
  { title: 'Setting up your contact details', slug: 'setting-up-your-contact-details', category: 'Updates', tags: ['updates', 'guides'],
    excerpt: 'Where the phone, email, address and social links appear, and how to fill them in.',
    body: '<p>The theme shows your contact details in two places: the slim bar above the header and the first column of the footer. Both are empty by default — fill in the phone, email and address in the theme settings to switch them on.</p><p>The same screen holds your social links. Each one you fill in becomes an icon in the top bar and the footer; leave a field empty and its icon is not shown.</p>' },
  { title: 'Writing clean, readable content', slug: 'writing-clean-readable-content', category: 'Tutorials', tags: ['guides', 'tutorials'],
    excerpt: 'Short paragraphs, clear headings and lists that help.',
    body: '<p>Readable content is good content. Keep paragraphs short and use headings to break up the page, so a reader can decide quickly whether to stay.</p><p>This post is long enough to show how headings, paragraphs and lists sit together in the reading column.</p><h3>A few tips</h3><ul><li>One idea per paragraph.</li><li>Lead with the point.</li><li>Break long sections with subheadings.</li></ul>' },
  { title: 'Site update: new pages and sub-pages', slug: 'site-update-new-pages', category: 'News', tags: ['updates', 'news'],
    excerpt: 'The demo content now includes a full page hierarchy.',
    body: '<p>We have added several top-level pages with sub-pages so the navigation has something real to show. Each parent page lists its children as cards, and a breadcrumb trail shows readers where they are.</p>' },
  { title: 'A review of the default theme', slug: 'a-review-of-the-default-theme', category: 'Reviews', tags: ['reviews'],
    excerpt: 'What the bundled theme does well and where it shines.',
    body: '<p>The default theme is a responsive design with a sticky header, dropdown menus, a homepage hero, clean cards and a rich footer. It handles pages, sub-pages, posts, archives, search and the 404 page from one consistent shell.</p><p>It has a light and a dark mode, and its accent colour, content width, homepage hero and contact details are all theme settings.</p>' },
  { title: 'Planning your page structure', slug: 'planning-your-page-structure', category: 'Tutorials', tags: ['guides', 'tutorials'],
    excerpt: 'Thinking through top-level pages and their sub-pages.',
    body: '<p>A clear page structure helps readers and search engines alike. Start with a handful of top-level pages and give each a few sub-pages where it makes sense.</p><p>This theme reflects exactly that structure: breadcrumbs on every sub-page, and cards for the children under their parent.</p>' },
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

  // A primary menu that mirrors the top-level pages, so the theme's header menu
  // has something to show. Home and Blog are already seeded
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
