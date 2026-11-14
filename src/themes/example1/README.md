# Example 1: a theme you can study

Example 1 is a full, optional theme derived from the bundled Ahmed Pro theme.
It is meant as a starting point, not a separate application or admin panel.

## Install and download

After the CMS patch is installed, go to **Appearance → Themes**, install Example 1,
then use its **Download** action to export it. Or upload the accompanying ZIP via
that same screen. Preview before activation. Activating a theme affects the public
site, not the admin panel.

## Package map

- `theme.json`: identity, template and asset paths, settings, menu locations.
- `templates/base.html`: shared document shell, icon symbols, header/footer calls.
- `templates/home.html`, `page.html`, `post.html`, `archive.html`, `search.html`, `404.html`: page-specific layouts.
- `partials/header.html`, `navigation.html`, `footer.html`, `social.html`: reusable site sections.
- `static/css/style.css`: responsive layout, colors, typography, icon sizing, dark mode.
- `static/js/theme.js`: public-site interaction; runs under the CMS security policy.
- `config/settings.json`: options exposed to the panel's theme customizer.
- `screenshot.png`: theme-store image.

The panel supplies content, menu items and settings. This example chooses a top
navigation and how those items are displayed. Another theme can choose a sidebar
in its own templates and CSS. Site identity and content remain in the CMS.

## Make your own

1. Unzip the package and rename the root folder. Change `slug` to exactly that
   folder name in `theme.json`, and change `name`, `author`, and version.
2. Edit the header, navigation, footer, templates and CSS. The inline SVG symbols
   in `base.html` are an example icon set; adjust the references as needed.
3. Declare any customizer options in `config/settings.json` and use them in
   templates as `{{theme.key}}`. The panel only shows declared settings.
4. Zip the **single root folder**, upload using Themes, validate and preview.
5. Test desktop, mobile, keyboard navigation, light/dark mode, search, 404,
   nested page menus and screen readers before activation.

Only supported template helpers and asset types work. See the CMS theme developer
guide. Do not assume a theme can change the admin UI or execute server-side code.
