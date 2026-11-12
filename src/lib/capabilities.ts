/**
 * Capabilities: what a user may do, stated once.
 *
 * Roles used to be checked with `can(user, 'editor')`, which meant every screen
 * had its own idea of what "editor" implies and a new role required editing
 * every route. A capability is a named permission; a role is a bundle of them.
 * Screens ask `can(user, 'moderate_comments')`, and the role → capability map
 * below is the only place that decides which role gets what.
 *
 * The defaults are exactly the permissions the roles had before this file
 * existed, so nothing changes for an existing site — the difference is that a
 * deployment (or, later, a `role_caps` table) can change one row instead of
 * hunting for `can(..., 'admin')` across the panel.
 */
import type { Role, User } from '../types';

export const CAPABILITIES = [
  'read',                 // signed in at all
  'write_posts',          // create and edit own posts
  'edit_others_posts',    // edit anyone's posts
  'manage_pages',         // pages, not just posts
  'moderate_comments',
  'manage_terms',         // categories and tags
  'manage_media',         // every file, not only one's own
  'manage_menus',
  'manage_themes',
  'manage_settings',
  'manage_plugins',
  'manage_users',
  'manage_tools',         // redirects, import/export, backups, health
  'manage_appearance',    // Customizer, Identity, Templates
  'manage_updates',       // run database updates, see the version screen
  'view_audit',           // the audit log
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * What each role may do by default. Author writes posts; editor also looks
 * after everyone's posts, pages, comments, categories, menus and media; admin
 * is everything, including the things that change the site itself.
 */
export const ROLE_CAPS: Record<Role, Capability[]> = {
  author: ['read', 'write_posts', 'manage_terms'],
  editor: [
    'read', 'write_posts', 'edit_others_posts', 'manage_pages', 'moderate_comments',
    'manage_terms', 'manage_media', 'manage_menus',
  ],
  admin: [...CAPABILITIES],
};

/** One capability, for one user. A role with no map entry can only read. */
export function can(user: Pick<User, 'role'> | null | undefined, capability: Capability): boolean {
  if (!user) return false;
  return (ROLE_CAPS[user.role] ?? ['read']).includes(capability);
}

/** Everything a role may do, in catalogue order (for the Users screen). */
export const capsFor = (role: Role): Capability[] => CAPABILITIES.filter((c) => can({ role }, c));

/** A one-line description of a role, generated from its capabilities. */
export function roleSummary(role: Role): string {
  const caps = capsFor(role);
  if (caps.length === CAPABILITIES.length) return 'Everything, including themes, settings and users.';
  const labels: Partial<Record<Capability, string>> = {
    write_posts: 'writes posts', edit_others_posts: "edits everyone's posts", manage_pages: 'manages pages',
    moderate_comments: 'moderates comments', manage_terms: 'manages categories', manage_media: 'manages the media library',
    manage_menus: 'manages menus',
  };
  return caps.map((c) => labels[c]).filter(Boolean).join(', ') + '.';
}
