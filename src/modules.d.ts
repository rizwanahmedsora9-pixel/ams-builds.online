declare module '*.sql' { const text: string; export default text; }
declare module '*.html' { const text: string; export default text; }
declare module '*.css' { const text: string; export default text; }
/**
 * Packaged files (a store theme's screenshot) are read as bytes, never as text.
 * The Node build uses esbuild's `binary` loader (a Uint8Array); Wrangler's Data
 * rule hands over an ArrayBuffer. Both are accepted.
 */
type PackagedBytes = ArrayBuffer | Uint8Array;
declare module '*.png' { const data: PackagedBytes; export default data; }
declare module '*.jpg' { const data: PackagedBytes; export default data; }
declare module '*.jpeg' { const data: PackagedBytes; export default data; }
declare module '*.webp' { const data: PackagedBytes; export default data; }
declare module '*.avif' { const data: PackagedBytes; export default data; }
declare module '*.ico' { const data: PackagedBytes; export default data; }
