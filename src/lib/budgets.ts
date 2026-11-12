/**
 * Performance budgets.
 *
 * The panel grew screen by screen until one CSS string was 31 KB inline in every
 * page; the point of a budget is that the next screen cannot do that again.
 * These are the *stated* limits — one file the panel, the check script and the
 * docs all read, so a number can never drift between them:
 *
 *   - a public page (what a visitor downloads)      45 KB gzipped
 *   - a panel page's HTML                           60 KB gzipped
 *   - the panel's three stylesheets together        25 KB gzipped
 *   - every script the panel ships                  30 KB gzipped
 *
 * Media is excluded everywhere: a photograph is content, not code. Enforcement
 * lives in scripts/measure.mjs (`npm run check:budgets`, part of `npm test`),
 * which measures the built server rather than a source file — the only number
 * that means anything is what `dist/server.mjs` sends.
 *
 * Kept free of imports so both the ESM script and the bundled panel can read it.
 */
export type Budget = { key: string; label: string; bytes: number };

export const BUDGETS: Budget[] = [
  { key: 'public_page', label: 'Public page, gzipped', bytes: 45 * 1024 },
  { key: 'admin_html', label: 'Panel page HTML, gzipped', bytes: 60 * 1024 },
  { key: 'admin_css', label: 'Panel CSS, all three files, gzipped', bytes: 25 * 1024 },
  { key: 'editor_js', label: 'Panel + editor JavaScript, gzipped', bytes: 30 * 1024 },
];

/**
 * What this build measured, written by `scripts/measure.mjs` on every test run.
 * The panel shows it so the limits are visible where the site is looked after;
 * the check fails the build, so the file is never stale for long.
 */
export type Measured = Record<string, number>;

export const budgetFor = (key: string): Budget | undefined => BUDGETS.find((b) => b.key === key);

/** gzip is what a browser actually downloads. */
export const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
