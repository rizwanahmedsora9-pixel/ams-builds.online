import type { Ctx } from '../types';
import { ADMIN_CSS, assetLinks } from '../admin/bundles';
import { APP_JS } from '../admin/components';
import { icon, iconSprite } from '../admin/icons';
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
  '/plugins': 'plugins',
  '/users': 'users',
  '/tools': 'tools',
  '/settings': 'settings',
};

const PREFS_PREFIX = '/preferences';

/** The sidebar definition, kept separate so tests and the command palette can read it. */
export function navGroups(user: { role: string }, pending: number): NavGroup[] {
  const admin = can(user as Ctx['var']['user'], 'admin');
  const editor = can(user as Ctx['var']['user'], 'editor');
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
      key: 'appearance', path: admin ? '/appearance' : '/menus', label: 'Appearance', icon: 'palette', show: admin || editor, children: [
        { path: '/appearance', label: 'Customize', show: admin },
        { path: '/themes', label: 'Themes', show: admin },
        { path: '/menus', label: 'Menus', show: editor },
        { path: '/widgets', label: 'Widgets', show: admin },
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
        { path: '/settings#discussion', label: 'Discussion' },
        { path: '/settings#domains', label: 'Domains & URL' },
      ],
    },
  ];
}

function renderRail(c: Ctx, groups: NavGroup[], activeKey: string, path: string, search: string): Raw {
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
    <label for="side-c" class="rail__collapse" title="Collapse or expand the sidebar">${icon('chevron-left', { cls: 'rail__ico' })}<span class="rail__label">Collapse Menu</span></label>
    <a class="rail__item" href="${base}/preferences"${activeKey === 'preferences' ? raw(' aria-current="page"') : raw('')} title="Preferences">${icon('settings', { cls: 'rail__ico' })}<span class="rail__label">Preferences</span></a>
  </div>
</nav>`;
}

function renderUserMenu(c: Ctx): Raw {
  const base = c.var.base;
  const user = c.var.user;
  return html`<details class="usermenu">
  <summary aria-label="Account menu"><span class="avatar" aria-hidden="true">${user.username.slice(0, 1)}</span><span>${user.username}</span></summary>
  <div class="usermenu__panel">
    <span class="usermenu__label">${user.role} · signed in</span>
    <a href="${base}/profile">${icon('user')} Profile</a>
    <a href="${base}/preferences">${icon('settings')} Preferences</a>
    <div class="usermenu__sep"></div>
    <form method="post" action="${base}/logout">${csrfField(c)}<button type="submit">${icon('logout')} Log out</button></form>
  </div>
</details>`;
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
  if (can(user, 'editor')) {
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
    siteTitle = (await getSettings(c.env)).site_title || '';
  } catch {
    /* settings not readable yet */
  }

  const page = html`<header class="topbar">
  <label for="nav-t" class="burger" aria-label="Menu">${icon('menu')}</label>
  <a class="topbar__brand" href="${base}">${icon('globe')}<span>${siteTitle || 'Dashboard'}</span></a>
  <span class="topbar__spacer"></span>
  <div class="topbar__actions">
    <a class="topbar__link" href="/" target="_blank" rel="noopener">${icon('external', { cls: 'ico--sm' })}<span>View site</span></a>
    ${renderUserMenu(c)}
  </div>
</header>
<input type="checkbox" id="nav-t" aria-hidden="true" tabindex="-1">
<input type="checkbox" id="side-c" aria-hidden="true" tabindex="-1"${prefs.railCollapsed ? raw(' checked') : raw('')}>
<div class="shell">
  ${renderRail(c, groups, activeKey, path, search)}
  <main class="main${opts.wide ? ' main--wide' : ''}" id="main">
    <div class="main__inner">
      ${flash(c)}${body}
    </div>
  </main>
</div>
${raw(APP_JS)}`;

  const doc = `<!doctype html><html lang="en"${documentAttrs(prefs)}>`
    + '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow">'
    + `<title>${esc(title)}${siteTitle && !title.includes(siteTitle) ? ` · ${esc(siteTitle)}` : ''} · Admin</title>`
    + assetLinks(base).s
    + '</head><body>'
    + `${iconSprite().s}<a class="skip" href="#main">Skip to content</a>${page.s}`
    + '</body></html>';
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
  const q = msg?.ok ? `?ok=${encodeURIComponent(msg.ok)}` : msg?.err ? `?err=${encodeURIComponent(msg.err)}` : '';
  return c.redirect(c.var.base + path + q, 303);
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
