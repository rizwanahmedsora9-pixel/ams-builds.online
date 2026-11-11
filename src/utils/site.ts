import { getSettingsEntry } from '../lib/content-source';

/**
 * Loads the singleton Site Settings entry (src/content/settings/site.yml,
 * overridden by the admin's Site Settings). Every layout/component should
 * read brand, contact, socials, hero and Google tags from here instead of
 * hardcoding strings.
 *
 * On a fresh/empty deployment (no site.yml and nothing yet in the CMS),
 * returns a complete set of defaults so the public site always renders —
 * no build crash, no missing-field errors. The admin panel fills in real
 * values the first time you save Site Settings.
 */
export async function getSite(locals?: unknown) {
  const entry = await getSettingsEntry(locals);
  if (!entry) {
    // Fresh install — no git file and no CMS store yet.
    // Return defaults so the site renders; admin fills in real values.
    return defaultSite();
  }
  if (!entry.data || typeof entry.data !== 'object') {
    return defaultSite();
  }
  return entry.data;
}

/** Fallback values used when no settings exist yet (fresh/empty deploy). */
function defaultSite() {
  return {
    siteName: 'AMS Builds',
    tagline: 'Web & App Development',
    shortDescription: '',
    url: 'https://ams-builds.online',
    logoText: 'AMS Builds',
    logoInitial: 'A',
    email: 'hello@example.com',
    phone: '+92 300 0000000',
    whatsapp: '',
    streetAddress: '',
    addressLocality: 'Gujrat',
    addressRegion: 'Punjab',
    addressCountry: 'Pakistan',
    postalCode: '',
    openingHours: 'Mo-Sa 09:00-18:00',
    priceRange: 'PKR',
    facebook: '',
    instagram: '',
    linkedin: '',
    youtube: '',
    github: '',
    twitter: '',
    googleSiteVerification: '',
    googleAnalyticsId: '',
    adsenseEnabled: false,
    adsenseClient: '',
    heroBadge: '',
    heroTitle: '',
    heroSubtitle: '',
    heroCtaText: 'Get a Free Quote',
    heroCtaUrl: '/contact/',
    heroImage: '/images/uploads/hero-dashboard.jpg',
    defaultOgImage: '/images/uploads/og-default.jpg',
    stats: [],
  };
}

/** Phone number as a tel: href (digits and leading + only). */
export function telHref(phone: string) {
  return 'tel:' + phone.replace(/[^+\d]/g, '');
}

/** Non-empty string or undefined (YAML empty strings should behave as missing). */
export function orUndef(v?: string) {
  const t = (v ?? '').trim();
  return t === '' ? undefined : t;
}
