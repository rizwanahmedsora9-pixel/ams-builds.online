import { getSettingsEntry } from '../lib/content-source';

/**
 * Loads the singleton Site Settings entry (src/content/settings/site.yml,
 * overridden by the admin's Site Settings). Every layout/component should
 * read brand, contact, socials, hero and Google tags from here instead of
 * hardcoding strings.
 */
export async function getSite() {
  const entry = await getSettingsEntry();
  if (!entry) {
    throw new Error('Missing site settings — required for build.');
  }
  return entry.data;
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
