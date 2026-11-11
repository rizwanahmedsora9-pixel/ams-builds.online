// Export payload for the public /admin/api/export endpoint and the dev store:
// published entries keep everything, drafts are reduced to metadata (the build
// only needs to know they exist and are drafts) and tombstones stay so git
// copies of deleted files stay deleted.
export function buildExportPayload(rows, settings) {
  const entries = [...(rows || [])]
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((row) => {
      const frontmatter = row.frontmatter && typeof row.frontmatter === 'object' ? row.frontmatter : {};
      const deleted = row.deleted === true;
      const draft = frontmatter.draft === true;
      let outFrontmatter = frontmatter;
      let outBody = typeof row.body === 'string' ? row.body : '';
      if (deleted) {
        outFrontmatter = {};
        outBody = '';
      } else if (draft) {
        outFrontmatter = { draft: true };
        if (typeof frontmatter.title === 'string') outFrontmatter.title = frontmatter.title;
        outBody = '';
      }
      return {
        slug: row.slug,
        type: row.type || '',
        updated_at: row.updated_at || '',
        deleted,
        draft,
        frontmatter: outFrontmatter,
        body: outBody,
      };
    });

  let outSettings = null;
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) outSettings = settings;
  return { entries, settings: outSettings };
}
