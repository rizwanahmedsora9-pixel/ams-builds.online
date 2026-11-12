declare module '*.sql' { const text: string; export default text; }
declare module '*.html' { const text: string; export default text; }
declare module '*.css' { const text: string; export default text; }
/** Packaged files (a store theme's screenshot) are read as bytes, never as text. */
declare module '*.png' { const data: ArrayBuffer; export default data; }
declare module '*.jpg' { const data: ArrayBuffer; export default data; }
declare module '*.jpeg' { const data: ArrayBuffer; export default data; }
declare module '*.webp' { const data: ArrayBuffer; export default data; }
declare module '*.avif' { const data: ArrayBuffer; export default data; }
declare module '*.ico' { const data: ArrayBuffer; export default data; }
