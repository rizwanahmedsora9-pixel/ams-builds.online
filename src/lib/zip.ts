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
