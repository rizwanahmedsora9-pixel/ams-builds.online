/**
 * The name a site shows for itself follows the domain it is being viewed on.
 *
 * One install can answer on several hostnames (a custom domain plus the
 * platform's own `*.vercel.app`, `*.workers.dev` or `*.onrender.com` address),
 * and the same code can be deployed again for a different domain. None of that
 * should mean retyping the site title: when the title was never renamed by hand,
 * it is derived from the hostname that served the request. The moment an admin
 * types their own title in Settings, that title wins everywhere.
 */

/** True when the stored title is still the name the installer guessed. */
export function isPlaceholderTitle(title: string | undefined): boolean {
  return !title || /^my site$/i.test(title.trim());
}

/** First label of a hostname: `ams-builds.online` -> `ams-builds`, `ams.vercel.app` -> `ams`. */
function firstLabel(hostname: string): string {
  return hostname.split('.')[0] || '';
}

/**
 * A hostname as a human site name. `www` is dropped, and the platform suffixes a
 * hostname can carry (vercel.app, workers.dev, onrender.com, a port, an IP
 * address) never become the name.
 */
export function siteNameFromHost(host: string): string {
  const hostname = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!hostname || /^\d+(\.\d+){3}$/.test(hostname)) return '';
  // The first label is the site's own name on every platform whose address is
  // `project.platform.tld` (`ams.vercel.app`, `ams.workers.dev`), and on an
  // ordinary domain it is the part before the dot.
  let label = firstLabel(hostname.replace(/^www\./, ''));
  // A preview address carries a generated suffix (`ams-3f2c9a.vercel.app`), so a
  // trailing block of letters and digits is dropped rather than read as a word.
  label = label.replace(/-[0-9a-z]*\d[0-9a-z]*$/i, '');
  const words = label.split(/[-_.]+/).filter(Boolean);
  if (!words.length) return '';
  const name = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .slice(0, 120);
  // `abc123` style project ids are not a name; keep the domain readable instead.
  return /[a-z]/i.test(name) ? name : '';
}

/**
 * The title to show: the admin's own title when they set one, otherwise a name
 * derived from the host this request arrived on, otherwise whatever is stored.
 */
export function displayTitle(stored: string | undefined, host: string): string {
  if (!isPlaceholderTitle(stored)) return stored as string;
  return siteNameFromHost(host) || (stored || '').trim();
}

/** The same decision for a request URL. */
export function titleFor(stored: string | undefined, url: URL): string {
  return displayTitle(stored, url.host);
}
