import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Config, Env, Role, User } from '../types';
import { timingSafeEqual } from './security';

const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 100_000; // the maximum Workers' WebCrypto accepts
export const SESSION_COOKIE = 'cms_session';
export const CSRF_COOKIE = 'cms_csrf';
const SESSION_TTL = 60 * 60 * 24 * 7;

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

export const randomToken = (bytes = 24): string => b64(crypto.getRandomValues(new Uint8Array(bytes)));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !salt || !hash) return false;
  return timingSafeEqual(await pbkdf2(password, unb64(salt), Number(iter)), hash);
}

export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

const isHttps = (c: Context): boolean => new URL(c.req.url).protocol === 'https:';

/* ----------------------------------------------------------------- sessions */
// Cookie = "{userId}.{expiry}.{HMAC}". The MAC also covers the password hash,
// so changing a password signs out every other session of that user.

const sessionSig = (cfg: Config, uid: number, exp: number, pwHash: string) => hmac(cfg.secret, `session:${uid}.${exp}.${pwHash}`);

export async function startSession(c: Context, cfg: Config, uid: number, pwHash: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  setCookie(c, SESSION_COOKIE, `${uid}.${exp}.${await sessionSig(cfg, uid, exp, pwHash)}`, {
    path: '/', httpOnly: true, secure: isHttps(c), sameSite: 'Lax', maxAge: SESSION_TTL,
  });
}

export const endSession = (c: Context): void => { deleteCookie(c, SESSION_COOKIE, { path: '/' }); };

export async function sessionUser(c: Context<any>, cfg: Config): Promise<User | null> {
  const [uid, exp, sig] = (getCookie(c, SESSION_COOKIE) || '').split('.');
  if (!sig || !/^\d+$/.test(uid) || !/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return null;
  const row = await (c.env as Env).DB.prepare('SELECT id, username, email, role, password_hash FROM users WHERE id=?')
    .bind(Number(uid)).first<User & { password_hash: string }>();
  if (!row || !timingSafeEqual(sig, await sessionSig(cfg, row.id, Number(exp), row.password_hash))) return null;
  return { id: row.id, username: row.username, email: row.email, role: row.role };
}

/* --------------------------------------------------------------------- CSRF */
// Signed double-submit: a random HttpOnly cookie, and forms carry HMAC(cookie).

export async function csrfToken(c: Context, cfg: Config): Promise<string> {
  let seed = getCookie(c, CSRF_COOKIE);
  if (!seed || !/^[\w-]{24,64}$/.test(seed)) {
    seed = randomToken();
    setCookie(c, CSRF_COOKIE, seed, { path: '/', httpOnly: true, secure: isHttps(c), sameSite: 'Lax', maxAge: 60 * 60 * 24 * 30 });
  }
  return hmac(cfg.secret, 'csrf:' + seed);
}

/* -------------------------------------------------------------------- roles */
const RANK: Record<Role, number> = { author: 1, editor: 2, admin: 3 };
export const can = (user: User, atLeast: Role): boolean => RANK[user.role] >= RANK[atLeast];
