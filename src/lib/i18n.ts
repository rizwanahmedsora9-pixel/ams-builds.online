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
  'caps.manage_themes': 'Themes and the theme store',
  'caps.manage_appearance': 'Customizer, Identity and Templates',
  'caps.moderate_comments': 'Moderate comments',
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

  // Theme store & lifecycle
  'themes.preview': 'Live preview',
  'themes.preview_hint': 'The real site, rendered with this theme. Nothing is activated.',
  'themes.back_to_store': 'Back to the theme store',
  'themes.rollback': 'Roll back',
  'themes.rollback_confirm': 'Replace the current files with this snapshot?',
  'themes.conflict': 'You have local edits to this theme.',
  'themes.conflict_keep': 'Save my changes as a copy, then update',
  'themes.conflict_replace': 'Replace my changes with the new version',
  'themes.export': 'Export as .zip',
  'themes.editor': 'Edit files',
  'themes.editor_hint': 'Plain text: no build step, no dependency. Every save is validated before it is stored.',
  'themes.saved': 'Saved {file}.',
  'themes.new_from': 'New theme from a template',
  'themes.style': 'Style',

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
