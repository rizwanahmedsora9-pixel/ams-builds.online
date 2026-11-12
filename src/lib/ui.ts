import type { Ctx } from '../types';
import { ADMIN_CSS, assetLinks } from '../admin/bundles';
import { APP_JS } from '../admin/components';
import { titleFor } from './origin';
import { icon, iconSprite } from '../admin/icons';
import { commandsFor } from '../admin/search';
import { PALETTE_JS, paletteConfig } from '../admin/palette';
import { can } from './auth';
import { pendingComments } from './comments';
import { getSettings } from './config';
import { readPrefs } from './prefs';
import { esc } from './security';

/** Marks a string as already-safe HTML. Everything else interpolated into html`` is escaped. */
export class Raw {
  constructor(public readonly s: string) {}
  toString(): string { return this.s; }
}
export const raw = (s: string): Raw => new Raw(s);

function val(v: unknown): string {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < values.length ? val(values[i]) : ''); });
  return new Raw(out);
}

/* --------------------------------------------------------------- documents */

/** Colour scheme + density classes on <html>, read from cookies before paint. */
function documentAttrs(prefs: { scheme: string; density: string }): string {
  const scheme = prefs.scheme === 'light' || prefs.scheme === 'dark' ? prefs.scheme : 'auto';
  const density = prefs.density === 'compact' ? 'compact' : 'comfortable';
  return ` data-scheme="${scheme}" data-density="${density}"`;
}

/**
 * A page outside the panel chrome: the login screen, the installer and the
 * error page. When the admin URL is known the stylesheets are linked (and
 * cacheable); without one - the installer on a fresh KV - they are inlined so
 * the wizard still looks right before any panel route exists.
 */
export function shell(title: string, body: Raw, opts: { base?: string; prefs?: { scheme: string; density: string } } = {}): string {
  const prefs = opts.prefs ?? { scheme: 'auto', density: 'comfortable' };
  const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>`;
  const styles = opts.base ? assetLinks(opts.base).s : `<style>${ADMIN_CSS}</style>`;
  return `<!doctype html><html lang="en"${documentAttrs(prefs)}><head>${head}${styles}</head><body>${body.s}</body></html>`;
}

export const csrfField = (c: Ctx): Raw => html`<input type="hidden" name="_csrf" value="${c.var.csrf}">`;

export const flash = (c: Ctx): Raw => {
  const ok = c.req.query('ok');
  const err = c.req.query('err');
  if (!ok && !err) return html``;
  return html`<div class="${err ? 'flash err' : 'flash'}" role="${err ? 'alert' : 'status'}">${icon(err ? 'alert' : 'check')}<span>${err || ok}</span></div>`;
};

/* ------------------------------------------------------------- navigation */

/** One sidebar entry: a top-level page with an optional list of sub-pages. */
type NavChild = { path: string; label: string; show?: boolean };
type NavGroup = { key: string; path: string; label: string; icon: string; show: boolean; badge?: number; children?: NavChild[] };

const ADMIN_SECTIONS: Record<string, string> = {
  '/updates': 'updates',
  '/posts': 'posts',
  '/media': 'media',
  '/pages': 'pages',
  '/comments': 'comments',
  '/terms': 'posts',
  '/themes': 'appearance',
  '/menus': 'appearance',
  '/widgets': 'appearance',
  '/appearance': 'appearance',
  '/templates': 'appearance',
  '/identity': 'appearance',
  '/plugins': 'plugins',
  '/users': 'users',
  '/tools': 'tools',
  '/settings': 'settings',
};

const PREFS_PREFIX = '/preferences';

/** The sidebar definition, kept separate so tests and the command palette can read it. */
export function navGroups(user: { role: string }, pending: number): NavGroup[] {
  const admin = can(user as Ctx['var']['user'], 'manage_settings');
  const editor = can(user as Ctx['var']['user'], 'edit_others_posts');
  return [
    { key: 'home', path: '', label: 'Dashboard', icon: 'home', show: true },
    { key: 'updates', path: '/updates', label: 'Updates', icon: 'refresh', show: admin },
    {
      key: 'posts', path: '/posts', label: 'Posts', icon: 'pin', show: true, children: [
        { path: '/posts', label: 'All Posts' },
        { path: '/posts/new', label: 'Add Post' },
        { path: '/terms?taxonomy=category', label: 'Categories' },
        { path: '/terms?taxonomy=tag', label: 'Tags' },
      ],
    },
    {
      key: 'media', path: '/media', label: 'Media', icon: 'image', show: true, children: [
        { path: '/media', label: 'Library' },
        { path: '/media#upload', label: 'Add New' },
      ],
    },
    {
      key: 'pages', path: '/pages', label: 'Pages', icon: 'file', show: editor, children: [
        { path: '/pages', label: 'All Pages' },
        { path: '/pages/new', label: 'Add New' },
      ],
    },
    {
      key: 'comments', path: '/comments', label: 'Comments', icon: 'message', show: editor, badge: pending, children: [
        { path: '/comments', label: 'All Comments' },
        { path: '/comments?status=pending', label: 'Pending' },
        { path: '/comments?status=approved', label: 'Approved' },
        { path: '/comments?status=spam', label: 'Spam' },
        { path: '/comments?status=trash', label: 'Trash' },
      ],
    },
    {
      // The Appearance hub: one place for how the site looks. A theme is what
      // renders it, a template is what renders one page, and widgets are the
      // places the theme opens up — the order below follows that question.
      key: 'appearance', path: admin ? '/appearance' : '/menus', label: 'Appearance', icon: 'palette', show: admin || editor, children: [
        { path: '/appearance', label: 'Customize', show: admin },
        { path: '/themes', label: 'Themes', show: admin },
        { path: '/templates', label: 'Templates', show: admin },
        { path: '/menus', label: 'Menus', show: editor },
        { path: '/widgets', label: 'Widgets', show: admin },
        { path: '/identity', label: 'Identity', show: admin },
      ],
    },
    {
      key: 'plugins', path: '/plugins', label: 'Plugins', icon: 'plug', show: admin, children: [
        { path: '/plugins', label: 'Installed Plugins' },
        { path: '/plugins/new', label: 'Add New' },
      ],
    },
    {
      key: 'users', path: '/users', label: 'Users', icon: 'users', show: admin, children: [
        { path: '/users', label: 'All Users' },
        { path: '/users/new', label: 'Add New' },
      ],
    },
    {
      key: 'tools', path: '/tools', label: 'Tools', icon: 'tools', show: admin, children: [
        { path: '/tools', label: 'Overview' },
        { path: '/tools/redirects', label: 'Redirects' },
        { path: '/tools/export', label: 'Import / Export' },
        { path: '/tools/backups', label: 'Backups' },
        { path: '/tools/health', label: 'Site Health' },
      ],
    },
    {
      key: 'settings', path: '/settings', label: 'Settings', icon: 'settings', show: admin, children: [
        { path: '/settings', label: 'General' },
        { path: '/settings#reading', label: 'Reading' },
        { path: '/settings#landing', label: 'Landing screen' },
        { path: '/settings#discussion', label: 'Discussion' },
        { path: '/settings#domains', label: 'Domains & URL' },
      ],
    },
  ];
}

function renderRail(c: Ctx, groups: NavGroup[], activeKey: string, path: string, search: string, prefs: { density: string }): Raw {
  const base = c.var.base;
  const isChildActive = (child: string) => (child.includes('?') ? path + search === child : path === child);
  const visible = groups.filter((g) => g.show);
  const items = visible.map((g, i) => {
    const children = (g.children || []).filter((ch) => ch.show !== false);
    const open = activeKey === g.key && children.length > 0;
    return html`${i ? html`<div class="rail__sep"></div>` : ''}
<a class="rail__item" href="${base + g.path}"${activeKey === g.key ? raw(' aria-current="page"') : raw('')} title="${g.label}">
  ${icon(g.icon, { cls: 'rail__ico' })}<span class="rail__label">${g.label}</span>${g.badge ? html`<span class="rail__bubble" title="${g.badge} pending">${g.badge}</span>` : ''}
</a>
${open ? html`<div class="rail__sub">${children.map((ch) => html`<a href="${base + ch.path}"${isChildActive(ch.path) ? raw(' aria-current="page"') : raw('')}>${ch.label}</a>`)}</div>` : ''}`;
  });
  return html`<nav class="rail" aria-label="Admin sections">
  <div class="rail__section">${items}</div>
  <div class="rail__foot">
    <a class="rail__item" href="${base}/preferences"${activeKey === 'preferences' ? raw(' aria-current="page"') : raw('')} title="Preferences">${icon('settings', { cls: 'rail__ico' })}<span class="rail__label">Preferences</span></a>
    <form method="post" action="${base}/density">${csrfField(c)}<button type="submit" title="Switch density">${icon('grid', { cls: 'rail__ico' })}<span class="rail__label">${prefs.density === 'compact' ? 'Comfortable view' : 'Compact view'}</span></button></form>
    ${railCollapseSwitch()}
  </div>
</nav>`;
}

function renderUserMenu(c: Ctx, prefs: { scheme: string; density: string }, path: string): Raw {
  const base = c.var.base;
  const user = c.var.user;
  return html`<details class="usermenu">
  <summary aria-label="Account menu"><span class="avatar" aria-hidden="true">${user.username.slice(0, 1)}</span><span class="usermenu__name">${user.username}</span></summary>
  <div class="usermenu__panel">
    <span class="usermenu__label">${user.role} · signed in</span>
    <a href="${base}/profile">${icon('user')} Profile</a>
    <a href="${base}/preferences">${icon('settings')} Preferences</a>
    <div class="usermenu__sep"></div>
    <span class="usermenu__label">Colour scheme</span>
    <div class="usermenu__schemes" role="group" aria-label="Colour scheme">
      ${(['auto', 'light', 'dark'] as const).map((scheme) => html`<a href="${base}/scheme/${scheme}?next=${encodeURIComponent(path)}"${prefs.scheme === scheme ? raw(' aria-pressed="true"') : raw('')} title="${scheme === 'auto' ? 'Match my system' : scheme}">${icon(scheme === 'auto' ? 'monitor' : scheme === 'light' ? 'sun' : 'moon', { cls: 'ico--sm' })}<span>${scheme === 'auto' ? 'System' : scheme[0].toUpperCase() + scheme.slice(1)}</span></a>`)}
    </div>
    <form method="post" action="${base}/density">${csrfField(c)}<button type="submit">${icon('grid', { cls: 'ico--sm' })} ${prefs.density === 'compact' ? 'Comfortable' : 'Compact'} density</button></form>
    <div class="usermenu__sep"></div>
    <form method="post" action="${base}/logout">${csrfField(c)}<button type="submit">${icon('logout')} Log out</button></form>
  </div>
</details>`;
}

/**
 * The in-rail collapse switch. A <label> for the `#side-c` checkbox the CSS
 * reads, so collapsing works with no JavaScript at all. It has to live *inside*
 * `.shell`: every collapsed-rail rule is written `#side-c:checked ~ .shell …`,
 * and a control rendered outside the shell would never be styled by them (it
 * would also keep its text while the rail is only 3.75rem wide).
 */
function railCollapseSwitch(): Raw {
  return html`<label for="side-c" class="rail__collapse" title="Collapse or expand the menu">${icon('chevron-left', { cls: 'ico--sm' })}<span class="rail__label">Collapse Menu</span></label>`;
}

/**
 * Expand control for the collapsed rail. A GET link, so it works without
 * JavaScript and keeps the collapsed state in a cookie the server reads on the
 * next request. It sits in the top bar because the rail itself is too narrow to
 * hold it when collapsed.
 */
function railToggleButton(base: string, prefs: { railCollapsed: boolean }, path: string, search: string): Raw {
  return html`<a class="rail-toggle" href="${base}/rail/${prefs.railCollapsed ? 'open' : 'collapsed'}?next=${encodeURIComponent(path + search)}" title="${prefs.railCollapsed ? 'Expand the menu' : 'Collapse the menu'}">${icon('chevron-right', { cls: 'ico--sm' })}<span class="sr-only">Toggle menu</span></a>`;
}

/**
 * The command palette (⌘K / Ctrl+K). A <dialog> containing a form that falls
 * back to the /search page when JavaScript is unavailable; with JavaScript the
 * client fetches /search?partial=1 as you type and takes over the arrow keys.
 */
function palette(c: Ctx, prefs: { scheme: string; density: string }): Raw {
  const base = c.var.base;
  const commands = commandsFor(base, c.var.user);
  const grouped = new Map<string, typeof commands>();
  for (const cmd of commands) {
    const list = grouped.get(cmd.group) || [];
    list.push(cmd);
    grouped.set(cmd.group, list);
  }
  return html`<dialog id="palette" class="palette" aria-labelledby="palette-title">
  <h2 id="palette-title" class="sr-only">Search and commands</h2>
  <form method="get" action="${base}/search" class="palette__form" role="search">
    <span class="palette__ico">${icon('search')}</span>
    <input type="search" id="palette-input" name="q" placeholder="Search posts, pages, media… or type a command"
           autocomplete="off" spellcheck="false" aria-controls="palette-results" aria-describedby="palette-help" maxlength="80">
    <button class="btn ghost small palette__close" type="button" data-palette-close>Esc</button>
  </form>
  <div class="palette__results" id="palette-results" role="region" aria-label="Search results">
    <div data-palette-commands>
      ${[...grouped].map(([group, items]) => html`<section class="search-group">
        <h3 class="search-group__title">${group}</h3>
        <ul class="search-hits">
          ${items.map((cmd, i) => html`<li>
            <a class="search-hit" id="palette-cmd-${i}" href="${cmd.href}" data-palette-item data-keys="${cmd.keys.join(' ')}">
              <span class="search-hit__ico">${icon(cmd.icon, { cls: 'ico--sm' })}</span>
              <span class="search-hit__body"><b>${cmd.label}</b></span>
            </a>
          </li>`)}
        </ul>
      </section>`)}
    </div>
    <div data-palette-live></div>
    <div id="palette-status" class="sr-only" role="status" aria-live="polite"></div>
  </div>
  <p class="palette__help hint" id="palette-help">
    <kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close
    <span class="palette__scheme">· <a href="${base}/preferences">Preferences</a></span>
  </p>
</dialog>`;
}

/**
 * Full admin page: top bar, sidebar (grouped, sub-menus for the open section,
 * badges, collapsible rail), flash message and the page body.
 *
 * The tab title is "<page> · <site> · Admin" so several open tabs are readable.
 */
export async function layout(c: Ctx, title: string, body: Raw, _active = '', opts: { wide?: boolean } = {}): Promise<Response> {
  const base = c.var.base;
  const user = c.var.user;
  const path = c.req.path || '/';
  const search = new URL(c.req.url).search;
  const prefs = readPrefs(c);

  let pending = 0;
  if (can(user, 'moderate_comments')) {
    try {
      pending = await pendingComments(c.env);
    } catch {
      /* comments table not migrated yet */
    }
  }

  const activeKey = path === '/' ? 'home'
    : path === '/profile' ? 'profile'
      : path.startsWith(PREFS_PREFIX) ? 'preferences'
        : (Object.entries(ADMIN_SECTIONS).find(([p]) => path === p || path.startsWith(p + '/'))?.[1] ?? '');

  const groups = navGroups(user, pending);
  let siteTitle = '';
  try {
    siteTitle = titleFor((await getSettings(c.env)).site_title || '', new URL(c.req.url));
  } catch {
    /* settings not readable yet */
  }

  const page = html`<input type="checkbox" id="nav-t" aria-hidden="true" tabindex="-1">
<input type="checkbox" id="side-c" aria-hidden="true" tabindex="-1"${prefs.railCollapsed ? raw(' checked') : raw('')}>
<header class="topbar">
  <label for="nav-t" class="burger" aria-label="Menu">${icon('menu')}</label>
  <a class="topbar__brand" href="${base}">${icon('globe')}<span class="topbar__title">${siteTitle || 'Dashboard'}</span></a>
  <span class="topbar__spacer"></span>
  <div class="topbar__actions">
    ${railToggleButton(base, prefs, path, search)}
    <a class="topbar__search" href="${base}/search" id="search-trigger" data-palette-open>
      ${icon('search', { cls: 'ico--sm' })}<span class="topbar__search-label">Search</span><kbd class="topbar__kbd">⌘K</kbd>
    </a>
    <a class="topbar__link" href="/" target="_blank" rel="noopener">${icon('external', { cls: 'ico--sm' })}<span class="topbar__link-label">View site</span></a>
    ${renderUserMenu(c, prefs, path)}
  </div>
</header>
<div class="shell">
  ${renderRail(c, groups, activeKey, path, search, prefs)}
  <main class="main${opts.wide ? ' main--wide' : ''}" id="main">
    <div class="main__inner">
      ${flash(c)}${body}
    </div>
  </main>
</div>
${palette(c, prefs)}`;

  const doc = `<!doctype html><html lang="en"${documentAttrs(prefs)}>`
    + '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow">'
    + `<title>${esc(title)}${siteTitle && !title.includes(siteTitle) ? ` · ${esc(siteTitle)}` : ''} · Admin</title>`
    + assetLinks(base).s
    + '</head><body>'
    + `${iconSprite().s}<a class="skip" href="#main">Skip to content</a>${page.s}`
    + `${raw(APP_JS).s}${raw(paletteConfig(base + '/search')).s}${raw(PALETTE_JS).s}</body></html>`;
  return c.html(doc);
}

export const errorPage = (c: Ctx, status: 400 | 403 | 404, message: string): Response =>
  c.html(shell('Error', html`<div class="error-page">
  <h1>${String(status)}</h1>
  <p>${message}</p>
  <p><a class="btn ghost" href="${c.var.base || '/'}">Back to the panel</a></p>
</div>`, { base: c.var.base }), status);

/** Redirect inside the admin with a flash message. */
export const go = (c: Ctx, path: string, msg?: { ok?: string; err?: string }): Response => {
  const q = msg?.ok ? `ok=${encodeURIComponent(msg.ok)}` : msg?.err ? `err=${encodeURIComponent(msg.err)}` : '';
  // Works for a path that already carries a query string ("/posts?status=draft")
  // and for one that names a section ("/settings#landing"), where the flash has
  // to go before the hash or the browser never sends it.
  const hashAt = path.indexOf('#');
  const hash = hashAt >= 0 ? path.slice(hashAt) : '';
  const bare = hashAt >= 0 ? path.slice(0, hashAt) : path;
  if (!q) return c.redirect(c.var.base + bare + hash, 303);
  return c.redirect(c.var.base + bare + (bare.includes('?') ? '&' : '?') + q + hash, 303);
};

/**
 * Renders a route that may throw, so a bug in one screen shows a styled error
 * page with the route name instead of a blank 500 from the runtime.
 */
export async function guardPage(c: Ctx, render: () => Promise<Response>): Promise<Response> {
  try {
    return await render();
  } catch (err) {
    console.error(`admin ${c.req.method} ${c.req.path} failed:`, err);
    const detail = err instanceof Error ? err.message : String(err);
    return c.html(shell('Something went wrong', html`
<div class="error-page">
  <h1>Something went wrong</h1>
  <p class="muted">This screen failed to render. The rest of the panel still works.</p>
  <pre class="pre">${c.req.method} ${c.req.path}
${detail}</pre>
  <p class="btn-row" style="justify-content:center">
    <a class="btn" href="${c.var.base || '/'}">Back to the dashboard</a>
    <button class="btn ghost" type="button" onclick="location.reload()">Try again</button>
  </p>
</div>`), 500);
  }
}
