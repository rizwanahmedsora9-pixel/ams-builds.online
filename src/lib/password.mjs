// PBKDF2 password hashing shared by the Durable Object (production) and the
// file-backed dev store. WebCrypto only — runs in workerd and in Node.
const ITERATIONS = 250000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

const encoder = new TextEncoder();

export function toBase64(bytes) {
  let binary = '';
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) {
    binary += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(text);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
  return u8;
}

async function deriveBits(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Hash a password. Returns { salt, hash, it } as base64 strings. */
export async function hashPassword(password, existingSalt) {
  const salt = existingSalt ? fromBase64(existingSalt) : crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(String(password), salt, ITERATIONS);
  return { salt: toBase64(salt), hash: toBase64(hash), it: ITERATIONS };
}

/** Constant-time verification. */
export async function verifyPassword(password, saltB64, hashB64, iterations) {
  try {
    const salt = fromBase64(saltB64);
    const expected = fromBase64(hashB64);
    const actual = await deriveBits(String(password), salt, Number(iterations) || ITERATIONS);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
