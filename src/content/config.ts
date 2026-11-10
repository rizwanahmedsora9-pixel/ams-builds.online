import { defineCollection, z } from 'astro:content';

// Shared SEO fields — editors get full control of slug (filename), SEO title,
// SEO description, OG image and noindex for every Pages / Projects / Blog entry.
const seoFields = {
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  ogImage: z.string().optional(),
  noindex: z.boolean().optional().default(false),
};

const pages = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string().optional().default(''),
    heroTitle: z.string().optional(),
    heroSubtitle: z.string().optional(),
    featuredImage: z.string().optional(),
    ...seoFields,
    navOrder: z.number().optional().default(99),
    showInNav: z.boolean().optional().default(false),
    showInFooter: z.boolean().optional().default(false),
    draft: z.boolean().optional().default(false),
    updatedDate: z.string().optional(),
  }),
});

const projects = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    client: z.string().optional().default(''),
    category: z.enum(['web', 'android', 'software', 'ecommerce']).default('web'),
    technologies: z.array(z.string()).optional().default([]),
    coverImage: z.string().optional(),
    featured: z.boolean().optional().default(false),
    date: z.string(),
    results: z.array(z.string()).optional().default([]),
    liveUrl: z.string().optional(),
    ...seoFields,
    draft: z.boolean().optional().default(false),
  }),
});

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.string(),
    updatedDate: z.string().optional(),
    author: z.string().optional().default('AMS Builds Team'),
    tags: z.array(z.string()).optional().default([]),
    heroImage: z.string().optional(),
    ...seoFields,
    draft: z.boolean().optional().default(false),
    featured: z.boolean().optional().default(false),
  }),
});

// Site Settings — singleton edited entirely from Decap CMS (/admin → "Site Settings").
// Controls: brand, contact, socials, hero, stats, Google Search Console verification,
// Google Analytics 4 and Google AdSense (enable toggle + publisher ID).
const settings = defineCollection({
  type: 'data',
  schema: z.object({
    siteName: z.string(),
    tagline: z.string().optional().default(''),
    shortDescription: z.string(),
    url: z.string().default('https://ams-builds.online'),
    logoText: z.string().optional().default('AMS Builds'),
    logoInitial: z.string().optional().default('A'),
    email: z.string(),
    phone: z.string(),
    whatsapp: z.string().optional().default(''),
    streetAddress: z.string().optional().default(''),
    addressLocality: z.string().optional().default('Gujrat'),
    addressRegion: z.string().optional().default('Punjab'),
    addressCountry: z.string().optional().default('Pakistan'),
    postalCode: z.string().optional().default(''),
    openingHours: z.string().optional().default('Mo-Sa 09:00-18:00'),
    priceRange: z.string().optional().default('PKR'),
    facebook: z.string().optional().default(''),
    instagram: z.string().optional().default(''),
    linkedin: z.string().optional().default(''),
    youtube: z.string().optional().default(''),
    github: z.string().optional().default(''),
    twitter: z.string().optional().default(''),
    googleSiteVerification: z.string().optional().default(''),
    googleAnalyticsId: z.string().optional().default(''),
    adsenseEnabled: z.boolean().optional().default(false),
    adsenseClient: z.string().optional().default(''),
    heroBadge: z.string().optional().default(''),
    heroTitle: z.string().optional().default(''),
    heroSubtitle: z.string().optional().default(''),
    heroCtaText: z.string().optional().default('Get a Free Quote'),
    heroCtaUrl: z.string().optional().default('/contact/'),
    heroImage: z.string().optional().default('/images/uploads/hero-dashboard.jpg'),
    defaultOgImage: z.string().optional().default('/images/uploads/og-default.jpg'),
    stats: z.array(z.object({ value: z.string(), label: z.string() })).optional().default([]),
  }),
});

export const collections = { pages, projects, blog, settings };
