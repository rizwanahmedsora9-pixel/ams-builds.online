// Store accessor for admin API routes: the file-backed dev store under
// `astro dev`, the CmsSite Durable Object everywhere else (wrangler dev,
// production, previews).
export async function getStore(locals) {
  if (import.meta.env.DEV) {
    const { createDevStore } = await import('./dev-store.mjs');
    return createDevStore();
  }
  const namespace = locals?.runtime?.env?.CMS;
  if (!namespace) {
    throw new Error('CMS storage is not available (missing CMS binding)');
  }
  const stub = namespace.getByName('site');
  return wrapDoStub(stub);
}

/** Thin async wrapper so the Durable Object stub matches the dev store API. */
function wrapDoStub(stub) {
  return {
    kind: 'do',
    getMeta: (key) => stub.getMeta(key),
    setMeta: (key, value) => stub.setMeta(key, value),
    listEntries: () => stub.listEntries(),
    getEntry: (slug) => stub.getEntry(slug),
    putEntry: (slug, type, frontmatter, body) => stub.putEntry(slug, type, frontmatter, body),
    deleteEntry: (slug, type) => stub.deleteEntry(slug, type),
    exportAll: () => stub.exportAll(),
    listMedia: () => stub.listMedia(),
    getMedia: (path) => stub.getMedia(path),
    putMedia: (path, mime, bytes) => stub.putMedia(path, mime, bytes),
    deleteMedia: (path) => stub.deleteMedia(path),
    login: (username, password) => stub.login(username, password),
    validateSession: (id) => stub.validateSession(id),
    logout: (id) => stub.logout(id),
    changePassword: (id, current, next) => stub.changePassword(id, current, next),
    recordPublish: (result) => stub.recordPublish(result),
    getLastPublish: () => stub.getLastPublish(),
  };
}
