/**
 * The Customizer's preview channel.
 *
 * Unsaved token values have to reach the renderer somehow. Three rules made
 * this module what it is:
 *
 *  1. Never in the query string. A URL is logged, shared and cached; a
 *     `?tokens={…}` would leak half-written settings and grow without bound.
 *  2. Never trusted from the browser. The preview cookie is signed (HMAC with
 *     the site secret) and carries an expiry, so only this server can mint one.
 *  3. Never cached, never public. The cookie is `HttpOnly`, `SameSite=Strict`,
 *     path-scoped to the site root, and the preview response is `no-store`.
 *
 * The cookie holds only *differences* from the saved settings, so it stays tiny.
 */
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Env } from '../types';

export const PREVIEW_COOKIE = 'ams_preview';
/** How long an unsaved preview stays valid; long enough to finish a colour choice. */
export const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_COOKIE = 3500; // browsers drop cookies past ~4 KB

export type PreviewPayload = {
  /** Theme to render with, when previewing a theme that is not active. */
  theme?: string;
  /** Token overrides, only the keys that differ from what is saved. */
  tokens?: Record<string, string>;
  /** Per-theme setting overrides (`{{theme.key}}`). */
  settings?: Record<string, string>;
  /** Hard expiry, epoch milliseconds. */
  exp: number;
};

const enc = new TextEncoder();

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (text: string): Uint8Array =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode('preview:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** `payload.signature`: both parts base64url. */
export async function signPreview(payload: PreviewPayload, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** Verifies and parses; any tampering or expiry returns null. */
export async function verifyPreview(value: string | undefined, secret: string): Promise<PreviewPayload | null> {
  if (!value) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as PreviewPayload;
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return {
      exp: payload.exp,
      theme: typeof payload.theme === 'string' ? payload.theme.slice(0, 60) : undefined,
      tokens: plainObject(payload.tokens),
      settings: plainObject(payload.settings),
    };
  } catch {
    return null;
  }
}

function plainObject(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 60)) {
    if (typeof k !== 'string' || !/^[a-z0-9_]{1,60}$/i.test(k)) continue;
    if (typeof v !== 'string') continue;
    out[k] = v.slice(0, 500);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Stores (or clears) the preview cookie for this response. */
export async function setPreviewCookie(c: Context<AppEnv>, payload: PreviewPayload): Promise<boolean> {
  const value = await signPreview(payload, c.var.cfg.secret);
  if (value.length > MAX_COOKIE) return false;
  setCookie(c, PREVIEW_COOKIE, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: Math.max(1, Math.floor((payload.exp - Date.now()) / 1000)),
  });
  return true;
}

export function clearPreviewCookie(c: Context<AppEnv>): void {
  deleteCookie(c, PREVIEW_COOKIE, { path: '/' });
}

/**
 * The payload for the current request, but only for a signed-in user: a cookie
 * that leaked could otherwise be replayed by anyone, so the check is here
 * rather than at the call site.
 */
export async function previewFor(c: Context<AppEnv>, signedIn: boolean): Promise<PreviewPayload | null> {
  if (!signedIn) return null;
  return verifyPreview(getCookie(c, PREVIEW_COOKIE), c.var.cfg.secret);
}

/** Differences only: what the browser sends is compared with what is saved. */
export function diff(proposed: Record<string, string>, saved: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(proposed)) {
    if ((saved[k] ?? '') !== v) out[k] = v;
  }
  return out;
}

/** Applies overrides on top of saved values (used by the renderer). */
export function applyOverrides(saved: Record<string, string>, overrides: Record<string, string> | undefined): Record<string, string> {
  return overrides ? { ...saved, ...overrides } : saved;
}

export type { Env };
