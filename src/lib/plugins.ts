import type { Env } from '../types';
import type { Settings } from './config';

/** Built-in plugins are features that ship with the CMS and can be switched off. */
export type BuiltinPlugin = { key: string; name: string; description: string; adminUrl: string };

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  { key: 'sitemap', name: 'XML Sitemap', description: 'Publishes /sitemap.xml listing every published page, post, category and tag.', adminUrl: '/sitemap.xml' },
  { key: 'robots', name: 'Robots.txt', description: 'Publishes /robots.txt so search engines know what to crawl and where the sitemap is.', adminUrl: '/robots.txt' },
  { key: 'rss', name: 'RSS Feed', description: 'Publishes /feed.xml with the twenty newest posts so readers can subscribe.', adminUrl: '/feed.xml' },
];

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
