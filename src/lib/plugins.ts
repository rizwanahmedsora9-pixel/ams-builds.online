import type { Env } from '../types';
import type { Settings } from './config';

/** Built-in plugins are features that ship with the CMS and can be switched off. */
export type BuiltinPlugin = { key: string; name: string; description: string; adminUrl: string; configureUrl?: string };

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  { key: 'sitemap', name: 'XML Sitemap', description: 'Publishes /sitemap.xml listing every published page, post, category and tag.', adminUrl: '/sitemap.xml' },
  { key: 'robots', name: 'Robots.txt', description: 'Publishes /robots.txt so search engines know what to crawl and where the sitemap is.', adminUrl: '/robots.txt' },
  { key: 'rss', name: 'RSS Feed', description: 'Publishes /feed.xml with the twenty newest posts so readers can subscribe.', adminUrl: '/feed.xml' },
  {
    key: 'search-verification', name: 'Search Console Verification',
    description: 'Verify your site with Google Search Console, Bing Webmaster and Yandex: paste the meta tag (or just the code) and it goes live in <head> — no theme editing.',
    adminUrl: '', configureUrl: '/plugins/search-verification',
  },
];

/* ------------------------------------------------- search verification */
/** Setting keys holding the bare verification token per search engine. */
export const VERIFICATION_ENGINES = [
  { key: 'google', setting: 'verify_google', metaName: 'google-site-verification', label: 'Google Search Console', help: 'In Google Search Console: Add property → URL prefix → “HTML tag”. Copy the whole <meta …> tag Google shows, or only the code inside content="…".' },
  { key: 'bing', setting: 'verify_bing', metaName: 'msvalidate.01', label: 'Bing Webmaster Tools', help: 'In Bing Webmaster: Add site → “HTML Meta Tag”. Paste the whole tag or only the code inside content="…".' },
  { key: 'yandex', setting: 'verify_yandex', metaName: 'yandex-verification', label: 'Yandex Webmaster', help: 'In Yandex Webmaster: Add site → “Meta tag”. Paste the whole tag or only the code inside content="…".' },
] as const;

export type VerificationEngine = (typeof VERIFICATION_ENGINES)[number];

/**
 * Turn whatever the admin pasted into a bare verification token.
 * Accepts: a full `<meta name="…" content="CODE">` tag (either quote style,
 * any attribute order), a `content="CODE"` fragment, or the bare code.
 * Returns '' when nothing token-like is found so bad pastes never reach <head>.
 */
export function extractVerificationCode(input: string, metaName?: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  let candidate = '';
  const metaFor = metaName
    ? new RegExp(`<meta[^>]*name\\s*=\\s*["']${metaName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i')
    : null;
  const tag = metaFor ? raw.match(metaFor)?.[0] : raw.match(/<meta[^>]*>/i)?.[0];
  const scope = tag || raw;
  const content = scope.match(/content\s*=\s*"([^"]+)"/i)?.[1] || scope.match(/content\s*=\s*'([^']+)'/i)?.[1];
  if (content) candidate = content.trim();
  else if (!/[<>]/.test(raw)) candidate = raw.replace(/^["']|["']$/g, '').trim();
  // Tokens are a single run of letters/digits/-/_ (Google also allows no dots).
  const token = candidate.match(/^[A-Za-z0-9_-]{8,200}$/) ? candidate : candidate.match(/[A-Za-z0-9_-]{16,200}/)?.[0] || '';
  return token;
}

/** The exact <meta> tag a token produces, or '' when it is not a safe token. */
export function verificationMetaTag(engine: VerificationEngine, token: string): string {
  const clean = extractVerificationCode(token, engine.metaName);
  return clean ? `<meta name="${engine.metaName}" content="${clean}">` : '';
}

/** All verification tags that should be printed in <head> right now. */
export function verificationTags(settings: Settings): string {
  if (!pluginOn(settings, 'search-verification')) return '';
  return VERIFICATION_ENGINES.map((e) => verificationMetaTag(e, settings[e.setting] || '')).filter(Boolean).join('\n');
}

export const pluginSetting = (key: string): string => `plugin_${key}`;

/** Unset means on: sites installed before plugins existed keep today's behaviour. */
export const pluginOn = (settings: Settings, key: string): boolean => settings[pluginSetting(key)] !== '0';

/** Where a snippet can be attached. Code is raw HTML, admins only. */
export const HOOK_POINTS = [
  { value: 'head', label: 'Inside <head> (meta tags, analytics, styles)' },
  { value: 'footer', label: 'Before </body> (scripts, chat widgets)' },
] as const;

export type HookPoint = (typeof HOOK_POINTS)[number]['value'];
export const isHookPoint = (v: string): v is HookPoint => HOOK_POINTS.some((h) => h.value === v);

export type HookRow = { id: number; name: string; hook: string; code: string; enabled: number; created_at: string };

export async function listHooks(env: Env): Promise<HookRow[]> {
  const { results } = await env.DB.prepare('SELECT id, name, hook, code, enabled, created_at FROM hooks WHERE site_id=1 ORDER BY id DESC')
    .all<HookRow>();
  return results;
}
