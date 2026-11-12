/**
 * Per-browser panel preferences.
 *
 * These are presentation-only (colour scheme, density, collapsed rail), so they
 * live in cookies rather than the database: the server can read them while
 * rendering the first byte, which means no flash of the wrong theme and no
 * layout jump on load. Nothing here is a security decision.
 */
import { getCookie, setCookie } from 'hono/cookie';
import type { Ctx } from '../types';

export const SCHEMES = ['auto', 'light', 'dark'] as const;
export type Scheme = (typeof SCHEMES)[number];
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export type PanelPrefs = {
  scheme: Scheme;
  density: Density;
  railCollapsed: boolean;
};

const ONE_YEAR = 60 * 60 * 24 * 365;
const COOKIE = { path: '/', sameSite: 'Lax', httpOnly: false, maxAge: ONE_YEAR } as const;

const pick = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;

export function readPrefs(c: Ctx): PanelPrefs {
  return {
    scheme: pick(getCookie(c, 'ams_scheme'), SCHEMES, 'auto'),
    density: pick(getCookie(c, 'ams_density'), DENSITIES, 'comfortable'),
    railCollapsed: getCookie(c, 'ams_rail') === '1',
  };
}

export function writePrefs(c: Ctx, prefs: Partial<PanelPrefs>): void {
  if (prefs.scheme) setCookie(c, 'ams_scheme', prefs.scheme, COOKIE);
  if (prefs.density) setCookie(c, 'ams_density', prefs.density, COOKIE);
  if (prefs.railCollapsed !== undefined) setCookie(c, 'ams_rail', prefs.railCollapsed ? '1' : '0', COOKIE);
}

/** Settings keys that a preference form may write. Anything else is ignored. */
export function parsePrefs(input: Record<string, unknown>): PanelPrefs {
  return {
    scheme: pick(typeof input.scheme === 'string' ? input.scheme : undefined, SCHEMES, 'auto'),
    density: pick(typeof input.density === 'string' ? input.density : undefined, DENSITIES, 'comfortable'),
    railCollapsed: input.railCollapsed === '1',
  };
}
