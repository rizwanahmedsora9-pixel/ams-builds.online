/**
 * Minimal ZIP reader (stored + deflate entries) built on the platform's
 * DecompressionStream, so theme bundles can be uploaded without a dependency.
 * Sizes are enforced while inflating, so a "zip bomb" cannot exhaust memory.
 */
export type ZipLimits = { maxEntries: number; maxTotalBytes: number };

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error('The zip file is too large once unpacked.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

export const isZip = (buf: ArrayBuffer): boolean => {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return b.length === 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
};

/** Returns file path -> bytes. Directories are skipped. */
export async function unzip(buf: ArrayBuffer, limits: ZipLimits): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const bad = () => new Error('This is not a valid zip file.');

  // End-of-central-directory record: search backwards (it may be followed by a comment).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw bad();
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  if (count > limits.maxEntries) throw new Error(`The zip file has too many files (limit ${limits.maxEntries}).`);

  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > bytes.length || view.getUint32(ptr, true) !== 0x02014b50) throw bad();
    const flags = view.getUint16(ptr + 8, true);
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const local = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen)).replace(/\\/g, '/');
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    if (flags & 1) throw new Error('Password-protected zip files are not supported.');
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw bad();
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compSize > bytes.length) throw bad();
    const raw = bytes.subarray(start, start + compSize);

    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw, limits.maxTotalBytes - total);
    else throw new Error(`"${name}" uses an unsupported compression method.`);
    total += data.length;
    if (total > limits.maxTotalBytes) throw new Error('The zip file is too large once unpacked.');
    files.set(name, data);
  }
  return files;
}

/* ------------------------------------------------------------------ writer */

/** CRC-32 (the polynomial zip uses). Table built once, on first export. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { path: string; data: Uint8Array | string };

/**
 * Writes a ZIP archive: stored entries only (no deflate).
 *
 * Storing means the archive needs no compression stream, so it works the same
 * on Workers and on Node with no dependency, and a theme's PNG/JPEG assets -
 * already compressed - would not shrink anyway. Templates and CSS are small
 * enough that the ~2 KB of extra bytes does not matter, and the reader accepts
 * stored entries, so an export round-trips through upload unchanged.
 */
export function zipFiles(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const files = entries.map((e) => ({ path: e.path.replace(/^\/+/, ''), bytes: typeof e.data === 'string' ? enc.encode(e.data) : e.data }));
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.path);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // local file header
    lv.setUint16(4, 20, true);           // version needed (2.0)
    lv.setUint16(6, 0x0800, true);       // flags: UTF-8 names
    lv.setUint16(8, 0, true);            // method: stored
    lv.setUint16(10, 0, true);           // time
    lv.setUint16(12, 0x2100, true);      // date: 1980-01-01, so an export is reproducible
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.bytes.length, true);
    lv.setUint32(22, file.bytes.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);           // extra field length
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);   // central directory header
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x2100, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.bytes.length, true);
    cv.setUint32(24, file.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);      // where the local header starts
    cd.set(name, 46);

    locals.push(local, file.bytes);
    central.push(cd);
    offset += local.length + file.bytes.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);     // end of central directory
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + end.length);
  let at = 0;
  for (const part of [...locals, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
