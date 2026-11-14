/**
 * Panel strings.
 *
 * Every user-facing string in the panel goes through `t()`, and the English
 * catalogue below is the only place they are written down. That is what makes a
 * second language a *data* change instead of a hunt through forty routes: a
 * route asks for `t('appearance.saved')`, and adding `es` later means one more
 * catalogue object.
 *
 * Two rules keep this honest rather than aspirational:
 *
 *  1. **Interpolation is data, not concatenation.** `t('audit.entries', { n: 12 })`
 *     with `"entries": "{n} entries"` lets a language put the number anywhere.
 *  2. **A missing key falls back to the key, loudly in tests.** `t('nope')`
 *     returns `nope`, and the test suite asserts that every key a route asks for
 *     exists — so drift is caught by CI, not by a visitor.
 */

export type Catalogue = Record<string, string>;

/** The reference catalogue. Keys are `area.thing`, lower-case, dotted. */
export const en: Catalogue = {
  // Shell
  'shell.skip': 'Skip to content',
  'shell.search': 'Search',
  'shell.view_site': 'View site',
  'shell.collapse': 'Collapse Menu',
  'shell.logout': 'Log out',
  'shell.profile': 'Profile',
  'shell.preferences': 'Preferences',
  'shell.density_compact': 'Compact',
  'shell.density_comfortable': 'Comfortable',

  // Audit log
  'audit.title': 'Audit log',
  'audit.intro': 'Every change made in the panel, newest first. Entries are kept for {days} days.',
  'audit.entries': '{n} entries',
  'audit.empty': 'No entries match these filters yet.',
  'audit.who': 'Who',
  'audit.what': 'What',
  'audit.when': 'When',
  'audit.where': 'Where',
  'audit.system': 'System',
  'audit.filter_user': 'By person',
  'audit.filter_action': 'By action',
  'audit.filter_type': 'By area',
  'audit.search': 'Search the summary',
  'audit.apply': 'Apply filters',
  'audit.clear': 'Clear',
  'audit.older': 'Older',
  'audit.newer': 'Newer',

  // Capabilities
  'caps.manage_themes': 'Upload, edit and activate themes',
  'caps.manage_appearance': 'Customizer, Identity and Templates',
  'caps.edit_others_posts': "Edit everyone's posts",
  'caps.manage_pages': 'Create and edit pages',
  'caps.manage_users': 'Users and roles',
  'caps.manage_settings': 'Site settings',
  'caps.manage_plugins': 'Plugins and custom code',
  'caps.manage_tools': 'Redirects, backups and import/export',
  'caps.manage_updates': 'Database updates',
  'caps.view_audit': 'Read the audit log',
  'caps.manage_menus': 'Menus',
  'caps.manage_terms': 'Categories and tags',
  'caps.manage_media': 'The media library',
  'caps.write_posts': 'Write and edit own posts',

  // Theme lifecycle
  'themes.preview': 'Live preview',
  'themes.preview_hint': 'The real site, rendered with this theme. Nothing is activated.',
  'themes.rollback': 'Roll back',
  'themes.rollback_confirm': 'Replace the current files with this snapshot?',
  'themes.export': 'Export as .zip',
  'themes.editor': 'Edit files',
  'themes.editor_hint': 'Plain text: no build step, no dependency. Every save is validated before it is stored.',
  'themes.saved': 'Saved {file}.',
  'themes.new_from': 'New theme from a template',
  'themes.style': 'Style',

  // Factory reset
  'reset.title': 'Reset the panel',
  'reset.intro': 'Delete every page, post, file, theme and account, then reopen the installer so the site can be set up again from nothing.',
  'reset.warning': 'This cannot be undone.',
  'reset.deleted_title': 'What gets deleted',
  'reset.count_pages': 'Pages',
  'reset.count_posts': 'Posts',
  'reset.count_media': 'Media files',
  'reset.count_users': 'Panel accounts, including yours',
  'reset.count_themes': 'Themes and their settings',
  'reset.count_menus': 'Menus',
  'reset.count_redirects': 'Redirects',
  'reset.count_backups': 'Backups stored on the server',
  'reset.also_deleted': 'Also gone: the audit log, every setting, the admin URL, the secret that keeps people signed in, the cached pages and the database password.',
  'reset.next_title': 'What happens next',
  'reset.next_body': 'You are signed out and sent to the installer. Pick a new admin account, site title, domain and admin URL, and the site starts from zero - the same state as a first run.',
  'reset.node_note': 'The database file stays on the disk, but every table in it is emptied and the media folder is cleared, so there is nothing left to read.',
  'reset.worker_note': 'Every table is dropped and every stored key is deleted. Key-value deletion can take a few seconds to reach every region, so the installer may appear a moment later.',
  'reset.export_first': 'Keep a copy first',
  'reset.export_hint': 'The export is one JSON file with your content, settings and themes. It is the only way to get anything back after a reset.',
  'reset.export_download': 'Download export',
  'reset.confirm_title': 'Confirm the reset',
  'reset.nothing_yet': 'This site has no content yet. A reset only clears the accounts and the settings.',
  'reset.password': 'Your panel password',
  'reset.password_hint': 'Required, and it must belong to the account you are signed in with.',
  'reset.confirm_label': 'Type {word} to continue',
  'reset.submit': 'Reset everything and start again',
  'reset.cancel': 'Keep everything',
  'reset.dialog': 'Delete every page, post, file and account and go back to the installer? This cannot be undone.',
  'reset.err_confirm': 'Type {word}, in capital letters, to confirm.',
  'reset.err_password': 'Your panel password is incorrect.',
  'reset.forbidden': 'Only an admin can reset the panel.',
  'reset.danger': 'Reset the panel',
  'reset.danger_hint': 'Built the site wrong? Delete everything and start again from the installer.',

  // Database password
  'health.db_password': 'Database password',
  'health.db_password_set': 'Set. The server refuses to open this database without DB_PASSWORD.',
  'health.db_password_unset': 'Not set. The file is protected by its permissions only; start the server with DB_PASSWORD to require one.',
  'health.db_password_na': 'Not needed here: this database is Cloudflare D1, reached only through the Worker binding.',

  // Budgets
  'budgets.title': 'Performance budgets',
  'budgets.intro': 'Measured on this build, enforced by npm test. A page that grows past its budget fails CI.',
  'budgets.measured': 'Measured',
  'budgets.budget': 'Budget',
  'budgets.public_page': 'Public page, gzipped',
  'budgets.admin_html': 'Panel page, gzipped',
  'budgets.admin_css': 'Panel CSS, all three files',
  'budgets.editor_js': 'Editor JavaScript',
};

/** Active language. One catalogue today; `setLocale` is where a second joins. */
let locale: Catalogue = en;
let language = 'en';

export const activeLanguage = (): string => language;

/** Install a catalogue (and optionally a fallback to English for gaps). */
export function setLocale(catalogue: Catalogue, tag = 'en'): void {
  locale = { ...en, ...catalogue };
  language = tag;
}

/** `{name}` placeholders, substituted without a template engine. */
function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/**
 * A translated string. A missing key returns the key itself: visible in
 * development, harmless in production, and the test suite fails on it.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return format(locale[key] ?? key, vars);
}

/** Every key present, for the test that checks routes only ask for real ones. */
export const catalogueKeys = (): string[] => Object.keys(locale);
