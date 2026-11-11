// Images committed to the repo (public/images/uploads) — listed so the admin
// image picker can offer them alongside CMS uploads.
const repoUploads = import.meta.glob('/public/images/uploads/*.{jpg,jpeg,png,webp,gif}', {
  eager: true,
});

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** [{ path, mime, source:'repo' }] — path is the public URL. */
export function repoImages() {
  return Object.keys(repoUploads)
    .map((p) => {
      const path = p.replace('/public', '');
      const ext = path.split('.').pop().toLowerCase();
      return { path, mime: MIME_BY_EXT[ext] || 'image/jpeg', source: 'repo' };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function repoImagePaths() {
  return new Set(repoImages().map((img) => img.path.split('/').pop()));
}
