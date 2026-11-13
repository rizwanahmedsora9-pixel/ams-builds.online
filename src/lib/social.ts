/** Supported profile fields shared by Settings and theme data. */
export const SOCIAL_PROFILES = [
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['x', 'X'],
  ['youtube', 'YouTube'], ['linkedin', 'LinkedIn'], ['github', 'GitHub'],
  ['tiktok', 'TikTok'], ['mastodon', 'Mastodon'],
] as const;

/** Only absolute HTTP(S) URLs with a hostname can become public links. */
export function socialUrl(value: string): string {
  if (!value || value.length > 2048) return '';
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
