/**
 * The theme the test suite installs.
 *
 * The app ships no themes at all: a new site renders bare, unstyled HTML until
 * its owner uploads one. The suite still needs a real theme to exercise the
 * engine — manifest parsing, templates and partials, assets, settings, previews,
 * the file editor, snapshots — so it uploads this package from tests/fixtures/
 * exactly the way an owner would. See tests/fixtures/README.md.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The fixture package: its identity, as its theme.json declares it. */
export const FIXTURE = { slug: 'site-theme', name: 'Site Theme', version: '1.0.0' };

export const FIXTURE_DIR = join(HERE, 'fixtures', FIXTURE.slug);

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

/**
 * Every file of the package, keyed the way a zip carries them
 * (`site-theme/theme.json`, `site-theme/templates/base.html`, …). Text only: the
 * fixture ships no images or fonts.
 */
export function fixtureFiles(slug = FIXTURE.slug, dir = FIXTURE_DIR) {
  const files = {};
  for (const path of walk(dir).sort()) {
    files[`${slug}/${relative(dir, path).split('\\').join('/')}`] = readFileSync(path, 'utf8');
  }
  return files;
}
