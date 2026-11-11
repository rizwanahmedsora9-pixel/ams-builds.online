// Field definitions for the admin editor — one place that drives the form UI,
// new-entry defaults and save-time validation. Mirrors src/content/schemas.mjs;
// the build re-validates with zod, this catches mistakes before saving.
import { isValidSlug, slugify } from './slug.mjs';

const SEO_FIELDS = [
  { name: 'seoTitle', label: 'SEO title (overrides the page title)', type: 'text' },
  { name: 'seoDescription', label: 'SEO description', type: 'textarea' },
  { name: 'ogImage', label: 'Social share image URL', type: 'media' },
  { name: 'noindex', label: 'Hide from search engines (noindex)', type: 'checkbox' },
];

export const BLOG_FIELDS = [
  { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'How Much Does …' },
  { name: 'description', label: 'Description (cards + SEO)', type: 'textarea', required: true },
  { name: 'pubDate', label: 'Publish date', type: 'date', required: true },
  { name: 'updatedDate', label: 'Updated date', type: 'date' },
  { name: 'author', label: 'Author', type: 'text', default: 'AMS Builds Team' },
  { name: 'tags', label: 'Tags', type: 'list', hint: 'Comma separated — shown as chips' },
  { name: 'heroImage', label: 'Hero image URL', type: 'media' },
  { name: 'featured', label: 'Featured on the homepage', type: 'checkbox' },
  { name: 'draft', label: 'Draft (hidden from the site)', type: 'checkbox' },
  ...SEO_FIELDS,
];

export const PAGE_FIELDS = [
  { name: 'title', label: 'Title', type: 'text', required: true },
  { name: 'description', label: 'Description (SEO)', type: 'textarea', required: true },
  { name: 'heroTitle', label: 'Hero heading', type: 'text' },
  { name: 'heroSubtitle', label: 'Hero sub-heading', type: 'textarea' },
  { name: 'featuredImage', label: 'Featured image URL', type: 'media' },
  { name: 'navOrder', label: 'Menu order', type: 'number', hint: 'Lower numbers appear first (99 = last)' },
  { name: 'showInNav', label: 'Show in the top menu', type: 'checkbox' },
  { name: 'showInFooter', label: 'Show in the footer links', type: 'checkbox' },
  { name: 'draft', label: 'Draft (hidden from the site)', type: 'checkbox' },
  { name: 'updatedDate', label: 'Updated date', type: 'date' },
  ...SEO_FIELDS,
];

export const PROJECT_FIELDS = [
  { name: 'title', label: 'Title', type: 'text', required: true },
  { name: 'description', label: 'Description (SEO)', type: 'textarea', required: true },
  { name: 'client', label: 'Client', type: 'text' },
  {
    name: 'category',
    label: 'Category',
    type: 'select',
    options: [
      { value: 'web', label: 'Web' },
      { value: 'android', label: 'Android' },
      { value: 'software', label: 'Software' },
      { value: 'ecommerce', label: 'E-commerce' },
    ],
    default: 'web',
  },
  { name: 'technologies', label: 'Technologies', type: 'list', hint: 'Comma separated' },
  { name: 'coverImage', label: 'Cover image URL', type: 'media' },
  { name: 'featured', label: 'Featured on the homepage', type: 'checkbox' },
  { name: 'date', label: 'Project date', type: 'date', required: true },
  { name: 'results', label: 'Results / highlights', type: 'list', hint: 'One per line' },
  { name: 'liveUrl', label: 'Live site URL', type: 'url' },
  { name: 'draft', label: 'Draft (hidden from the site)', type: 'checkbox' },
  ...SEO_FIELDS,
];

export const SETTINGS_SECTIONS = [
  {
    title: 'Brand',
    fields: [
      { name: 'siteName', label: 'Site name', type: 'text', required: true },
      { name: 'tagline', label: 'Tagline', type: 'text' },
      { name: 'shortDescription', label: 'Short description', type: 'textarea', required: true },
      { name: 'url', label: 'Site URL', type: 'url' },
      { name: 'logoText', label: 'Logo text', type: 'text' },
      { name: 'logoInitial', label: 'Logo initial', type: 'text' },
      { name: 'defaultOgImage', label: 'Default share image URL', type: 'media' },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'phone', label: 'Phone', type: 'text', required: true },
      { name: 'whatsapp', label: 'WhatsApp number (digits only)', type: 'text' },
      { name: 'streetAddress', label: 'Street address', type: 'text' },
      { name: 'addressLocality', label: 'City', type: 'text' },
      { name: 'addressRegion', label: 'Region / province', type: 'text' },
      { name: 'addressCountry', label: 'Country', type: 'text' },
      { name: 'postalCode', label: 'Postal code', type: 'text' },
      { name: 'openingHours', label: 'Opening hours', type: 'text' },
      { name: 'priceRange', label: 'Price range', type: 'text' },
    ],
  },
  {
    title: 'Social links',
    fields: [
      { name: 'facebook', label: 'Facebook URL', type: 'url' },
      { name: 'instagram', label: 'Instagram URL', type: 'url' },
      { name: 'linkedin', label: 'LinkedIn URL', type: 'url' },
      { name: 'youtube', label: 'YouTube URL', type: 'url' },
      { name: 'github', label: 'GitHub URL', type: 'url' },
      { name: 'twitter', label: 'X / Twitter URL', type: 'url' },
    ],
  },
  {
    title: 'Homepage hero',
    fields: [
      { name: 'heroBadge', label: 'Badge text', type: 'text' },
      { name: 'heroTitle', label: 'Hero heading', type: 'text' },
      { name: 'heroSubtitle', label: 'Hero sub-heading', type: 'textarea' },
      { name: 'heroCtaText', label: 'Button text', type: 'text', default: 'Get a Free Quote' },
      { name: 'heroCtaUrl', label: 'Button link', type: 'text', default: '/contact/' },
      { name: 'heroImage', label: 'Hero image URL', type: 'media' },
      { name: 'stats', label: 'Stats (shown under the hero)', type: 'pairs' },
    ],
  },
  {
    title: 'Google & ads',
    fields: [
      { name: 'googleSiteVerification', label: 'Search Console verification tag', type: 'text' },
      { name: 'googleAnalyticsId', label: 'GA4 measurement ID', type: 'text' },
      { name: 'adsenseEnabled', label: 'Enable Google AdSense', type: 'checkbox' },
      { name: 'adsenseClient', label: 'AdSense publisher ID (ca-pub-…)', type: 'text' },
    ],
  },
];

export const CONTENT_FIELDS = {
  blog: BLOG_FIELDS,
  pages: PAGE_FIELDS,
  projects: PROJECT_FIELDS,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = ['web', 'android', 'software', 'ecommerce'];

/** New-entry defaults matching the zod schemas. */
export function defaultData(type) {
  const fields = CONTENT_FIELDS[type] || [];
  const data = {};
  for (const field of fields) {
    if (field.default !== undefined) data[field.name] = field.default;
    else if (field.type === 'checkbox') data[field.name] = false;
    else if (field.type === 'list') data[field.name] = [];
    else if (field.type === 'pairs') data[field.name] = [];
    else if (field.type === 'number') data[field.name] = 99;
    else if (field.type === 'date') data[field.name] = '';
    else data[field.name] = '';
  }
  if (type === 'blog') {
    data.pubDate = today();
    data.author = 'AMS Builds Team';
  }
  if (type === 'projects') data.date = today();
  if (type === 'pages') data.navOrder = 99;
  return data;
}

export function defaultSettings() {
  const data = {};
  for (const section of SETTINGS_SECTIONS) {
    for (const field of section.fields) {
      if (field.default !== undefined) data[field.name] = field.default;
      else if (field.type === 'checkbox') data[field.name] = false;
      else if (field.type === 'pairs') data[field.name] = [];
      else data[field.name] = '';
    }
  }
  data.url = 'https://ams-builds.online';
  data.logoText = 'AMS Builds';
  data.logoInitial = 'A';
  data.addressLocality = 'Gujrat';
  data.addressRegion = 'Punjab';
  data.addressCountry = 'Pakistan';
  data.openingHours = 'Mo-Sa 09:00-18:00';
  data.priceRange = 'PKR';
  data.heroImage = '/images/uploads/hero-dashboard.jpg';
  data.defaultOgImage = '/images/uploads/og-default.jpg';
  return data;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isStr(v) {
  return typeof v === 'string';
}

function checkDate(value, label, errors, optional = false) {
  if (value === '' || value === null || value === undefined) {
    if (!optional) errors.push(`${label} is required`);
    return;
  }
  if (!isStr(value) || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    errors.push(`${label} must be a date (YYYY-MM-DD)`);
  }
}

function checkList(value, label, errors) {
  if (value === undefined || value === null || value === '') return;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    errors.push(`${label} must be a list of text items`);
  }
}

function checkBooleans(data, errors) {
  for (const key of ['draft', 'featured', 'showInNav', 'showInFooter', 'noindex', 'adsenseEnabled']) {
    if (key in data && typeof data[key] !== 'boolean') errors.push(`${key} must be on or off`);
  }
}

/** Save-time validation for one content entry. Returns [] when valid. */
export function validateEntry(type, data, body) {
  const errors = [];
  if (!data || typeof data !== 'object') return ['Nothing to save'];
  if (typeof body !== 'string') errors.push('Body must be text');
  for (const [key, value] of Object.entries(data)) {
    if (key === 'stats' || key === 'tags' || key === 'results' || key === 'technologies') continue;
    if (key === 'navOrder') continue;
    if (['draft', 'featured', 'showInNav', 'showInFooter', 'noindex', 'adsenseEnabled'].includes(key)) continue;
    if (value !== null && value !== undefined && typeof value !== 'string') {
      errors.push(`${key} must be text`);
    }
  }
  checkBooleans(data, errors);

  if (type === 'blog') {
    if (!isStr(data.title) || !data.title.trim()) errors.push('Title is required');
    if (!isStr(data.description) || !data.description.trim()) errors.push('Description is required');
    checkDate(data.pubDate, 'Publish date', errors);
    checkDate(data.updatedDate, 'Updated date', errors, true);
    checkList(data.tags, 'Tags', errors);
  } else if (type === 'pages') {
    if (!isStr(data.title) || !data.title.trim()) errors.push('Title is required');
    if (!isStr(data.description)) errors.push('Description must be text');
    checkDate(data.updatedDate, 'Updated date', errors, true);
    if ('navOrder' in data && data.navOrder !== '' && Number.isNaN(Number(data.navOrder))) {
      errors.push('Menu order must be a number');
    }
  } else if (type === 'projects') {
    if (!isStr(data.title) || !data.title.trim()) errors.push('Title is required');
    if (!isStr(data.description) || !data.description.trim()) errors.push('Description is required');
    checkDate(data.date, 'Project date', errors);
    if (data.category && !CATEGORIES.includes(data.category)) errors.push('Pick a valid category');
    checkList(data.technologies, 'Technologies', errors);
    checkList(data.results, 'Results', errors);
  } else {
    errors.push(`Unknown content type "${type}"`);
  }
  return errors;
}

/** Save-time validation for site settings. */
export function validateSettings(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return ['Nothing to save'];
  for (const section of SETTINGS_SECTIONS) {
    for (const field of section.fields) {
      const value = data[field.name];
      if (field.required && (value === undefined || value === null || String(value).trim() === '')) {
        errors.push(`${field.label} is required`);
      }
      if (field.type === 'checkbox' && field.name in data && typeof value !== 'boolean') {
        errors.push(`${field.label} must be on or off`);
      }
      if (field.type === 'pairs') {
        if (!Array.isArray(value) || value.some((row) => !row || typeof row.value !== 'string' || typeof row.label !== 'string')) {
          errors.push(`${field.label} must be a list of value/label pairs`);
        }
      } else if (field.type === 'list') {
        checkList(value, field.label, errors);
      } else if (field.type !== 'checkbox' && value !== undefined && value !== null && typeof value !== 'string') {
        errors.push(`${field.label} must be text`);
      }
    }
  }
  return errors;
}

/** Client-side slug suggestion from a title. */
export function suggestSlug(title) {
  return slugify(title);
}

export { isValidSlug };
