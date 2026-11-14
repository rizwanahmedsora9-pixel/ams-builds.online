# Test fixtures

## `site-theme/` — the theme the test suite installs

The app ships **no themes**. A fresh site is a clean slate: bare, unstyled HTML
until its owner uploads a theme and activates it.

The suite still has to exercise the theme engine end to end — a v3 manifest,
templates and partials, a stylesheet and a script served as theme assets, theme
settings, the live preview, the file editor, version snapshots — and it cannot do
that against nothing. So it uploads this package, the way an owner would.

It is test data and nothing else:

- it is not bundled into the app (`npm run build` never reads `tests/`),
- it is not listed, offered or installed anywhere in the admin panel,
- it is not a starting point for a real site — the docs describe the package
  format, and **Admin → Themes → Make your own** creates a starter in the panel.

`fixture-theme.mjs` (one directory up) reads this folder and hands the suite a
zip of it.
