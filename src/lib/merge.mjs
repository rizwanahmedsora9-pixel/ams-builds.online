// Pure merge logic: CMS overrides layered on top of the git-tracked files.
// Kept glob-free so both browser CMS runtime and Node tests can import it.

function entryKey(entry) {
  return entry?.type ? `${entry.type}:${entry.slug}` : String(entry?.slug ?? '');
}

/**
 * Apply CMS overrides on top of the file entries. An override replaces the
 * whole entry; a tombstone (deleted: true) removes it so deleted posts do
 * not come back from git.
 */
export function mergeEntries(base, overrides) {
  const byKey = new Map();
  for (const entry of base || []) {
    if (!entry || typeof entry.slug !== 'string' || !entry.slug) continue;
    byKey.set(entryKey(entry), entry);
  }
  for (const row of overrides || []) {
    if (!row || typeof row.slug !== 'string' || !row.slug) continue;
    const key = entryKey(row);
    if (row.deleted) {
      byKey.delete(key);
      continue;
    }
    const existing = byKey.get(key);
    byKey.set(key, {
      slug: row.slug,
      type: row.type || existing?.type || '',
      data: row.frontmatter || row.data || {},
      body: typeof row.body === 'string' ? row.body : '',
      source: 'cms',
      updated_at: row.updated_at || null,
    });
  }
  return [...byKey.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** Settings override wins when the CMS has saved settings at least once. */
export function mergeSettings(base, override) {
  if (override && typeof override === 'object' && !Array.isArray(override)) {
    return { ...(base || {}), ...override };
  }
  return base || {};
}
