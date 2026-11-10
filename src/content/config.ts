import { defineCollection, z } from 'astro:content';

// Helpers so CMS-authored YAML (unquoted YYYY-MM-DD dates parsed as Date,
// cleared optional strings/images saved as null/empty) always builds cleanly.
const optString = () =>
  z.preprocess((val) => (val === null ? undefined : val), z.string().optional());

const optStringDefault = (fallback = '') =>
  z.preprocess((val) => (val === null || val === undefined ? fallback : val), z.string());

const reqDateString = () =>
  z.preprocess(
    (val) => (val instanceof Date ? val.toISOString().slice(0, 10) : val),
    z.string(),
  );

const optDateString = () =>
  z.preprocess((val) => {
    if (val === null || val === undefined || val === '') return undefined;
    return val instanceof Date ? val.toISOString().slice(0, 10) : val;
  }, z.string().optional());

const optStringList = () =>
  z.preprocess(
    (val) => (val === null || val === undefined ? [] : val),
    z.array(z.string()),
  );

const optBoolean = (fallback = false) =>
  z.preprocess((val) => (val === null || val === undefined ? fallback : val), z.boolean());

// Shared SEO fields — editors get full control of slug (filename), SEO title,
// SEO description, OG image and noindex for every Pages / Projects / Blog entry.
const seoFields = {
  seoTitle: optString(),
  seoDescription: optString(),
  ogImage: optString(),
  noindex: optBoolean(false),
};

const pages = defineCollection({
  schema: z.object({
    title: z.string(),
    description: optStringDefault(''),
    heroTitle: optString(),
    heroSubtitle: optString(),
    featuredImage: optString(),
    ...seoFields,
    navOrder: z.preprocess(
      (val) => (val === null || val === undefined || val === '' ? 99 : Number(val)),
      z.number(),
    ),
    showInNav: optBoolean(false),
    showInFooter: optBoolean(false),
    draft: optBoolean(false),
    updatedDate: optDateString(),
  }),
});

const projects = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    client: optStringDefault(''),
    category: z.enum(['web', 'android', 'software', 'ecommerce']).default('web'),
    technologies: optStringList(),
    coverImage: optString(),
    featured: optBoolean(false),
    date: reqDateString(),
    results: optStringList(),
    liveUrl: optString(),
    ...seoFields,
    draft: optBoolean(false),
  }),
});

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: reqDateString(),
    updatedDate: optDateString(),
    author: optStringDefault('AMS Builds Team'),
    tags: optStringList(),
    heroImage: optString(),
    ...seoFields,
    draft: optBoolean(false),
    featured: optBoolean(false),
  }),
});

// Site Settings — singleton edited entirely from Decap CMS (/admin → "Site Settings").
// Controls: brand, contact, socials, hero, stats, Google Search Console verification,
// Google Analytics 4 and Google AdSense (enable toggle + publisher ID).
const settings = defineCollection({
  type: 'data',
  schema: z.object({
    siteName: z.string(),
    tagline: optStringDefault(''),
    shortDescription: z.string(),
    url: optStringDefault('https://ams-builds.online'),
    logoText: optStringDefault('AMS Builds'),
    logoInitial: optStringDefault('A'),
    email: z.string(),
    phone: z.string(),
    whatsapp: optStringDefault(''),
    streetAddress: optStringDefault(''),
    addressLocality: optStringDefault('Gujrat'),
    addressRegion: optStringDefault('Punjab'),
    addressCountry: optStringDefault('Pakistan'),
    postalCode: optStringDefault(''),
    openingHours: optStringDefault('Mo-Sa 09:00-18:00'),
    priceRange: optStringDefault('PKR'),
    facebook: optStringDefault(''),
    instagram: optStringDefault(''),
    linkedin: optStringDefault(''),
    youtube: optStringDefault(''),
    github: optStringDefault(''),
    twitter: optStringDefault(''),
    googleSiteVerification: optStringDefault(''),
    googleAnalyticsId: optStringDefault(''),
    adsenseEnabled: optBoolean(false),
    adsenseClient: optStringDefault(''),
    heroBadge: optStringDefault(''),
    heroTitle: optStringDefault(''),
    heroSubtitle: optStringDefault(''),
    heroCtaText: optStringDefault('Get a Free Quote'),
    heroCtaUrl: optStringDefault('/contact/'),
    heroImage: optStringDefault('/images/uploads/hero-dashboard.jpg'),
    defaultOgImage: optStringDefault('/images/uploads/og-default.jpg'),
    stats: z.preprocess(
      (val) => (val === null || val === undefined ? [] : val),
      z.array(z.object({ value: z.string(), label: z.string() })),
    ),
  }),
});

export const collections = { pages, projects, blog, settings };
