/**
 * One source of truth for what the media library and the editor's media picker
 * accept, and for the Content-Type each extension is stored with.
 *
 * The browser-sent MIME type is never trusted: the extension decides the type,
 * so a renamed script cannot arrive as an image. Images cover every format a
 * camera, phone or design tool realistically produces; the client converts the
 * static raster ones to size-targeted WebP before upload (see
 * src/admin/media-compress.ts). The original is kept when it already fits the
 * target, when it is animated/vector, when conversion is off, or when the
 * browser cannot decode/compress it.
 */

export const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  pjpeg: 'image/jpeg',
  pjp: 'image/jpeg',
  png: 'image/png',
  apng: 'image/apng',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  svg: 'image/svg+xml',
};

/** Non-image files the library also stores (documents, audio, video, fonts). */
export const OTHER_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  zip: 'application/zip',
  woff2: 'font/woff2',
};

/** Everything the library accepts, keyed by lower-case extension. */
export const FILE_TYPES: Record<string, string> = { ...IMAGE_TYPES, ...OTHER_TYPES };

/** SVG can carry script, so it is served sandboxed and only admins may upload it. */
export const ADMIN_ONLY_EXT = new Set(['svg']);

const dotted = (types: Record<string, string>): string[] => Object.keys(types).map((ext) => '.' + ext);

/** `accept` attribute for an image-only input, permissive about odd extensions. */
export const IMAGE_ACCEPT = ['image/*', ...dotted(IMAGE_TYPES)].join(',');

/** `accept` attribute for the media library's upload input. */
export const FILE_ACCEPT = dotted(FILE_TYPES).join(',');

export const isImageMime = (mime: string): boolean => mime.startsWith('image/');
