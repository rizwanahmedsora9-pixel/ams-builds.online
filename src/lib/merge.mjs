// Pure merge logic: CMS overrides (rows from the admin store / build export)
// layered on top of the git-tracked files. Kept glob-free so tests can import
// it straight from Node.

/**
 * Apply CMS overrides on top of the file entries. An override replaces the
 * whole entry; a tombstone (deleted: true) removes it so deleted posts do
 * not come back from git.
 */
export function mergeEntries(base, overrides) {
  const bySlug = new Map(base.map((entry) => [entry.slug, entry]));
  for (const row of overrides || []) {
    if (!row || typeof row.slug !== 'string' || !row.slug) continue;
    if (row.deleted) {
      bySlug.delete(row.slug);
      continue;
    }
    bySlug.set(row.slug, {
      slug: row.slug,
      type: row.type || bySlug.get(row.slug)?.type,
      data: row.frontmatter || {},
      body: typeof row.body === 'string' ? row.body : '',
    });
  }
  return [...bySlug.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** Settings override wins when the CMS has saved settings at least once. */
export function mergeSettings(base, override) {
  if (override && typeof override === 'object' && !Array.isArray(override)) return override;
  return base;
}
